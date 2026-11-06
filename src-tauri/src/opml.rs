use crate::db::now_iso;
use crate::error::{AppError, AppResult};
use crate::feeds;
use crate::models::{AddFeedArgs, OpmlExportResult, OpmlImportResult};
use rusqlite::{params, Connection};
use std::collections::BTreeMap;
use std::path::Path;

fn attr(node: &roxmltree::Node<'_, '_>, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(value) = node.attribute(*name) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn ensure_folder(conn: &Connection, name: &str, position: i64) -> AppResult<i64> {
    conn.execute(
        "INSERT OR IGNORE INTO folders(name, position, created_at) VALUES(?1, ?2, ?3)",
        params![name, position, now_iso()],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM folders WHERE name = ?1",
        params![name],
        |r| r.get(0),
    )?;
    Ok(id)
}

struct OutlineFeed {
    url: String,
    title: Option<String>,
    folder: Option<String>,
}

fn collect_outlines(
    node: roxmltree::Node<'_, '_>,
    folder: Option<&str>,
    folders: &mut Vec<String>,
    feeds_out: &mut Vec<OutlineFeed>,
) {
    for child in node.children().filter(|n| n.has_tag_name("outline")) {
        let xml_url = attr(&child, &["xmlUrl", "xmlurl", "xmlURL"]);
        if let Some(url) = xml_url {
            let title = attr(&child, &["title", "text"]);
            feeds_out.push(OutlineFeed {
                url,
                title,
                folder: folder.map(str::to_string),
            });
        } else {
            let name = attr(&child, &["title", "text"]).unwrap_or_else(|| "Folder".to_string());
            if !folders.iter().any(|f| f.eq_ignore_ascii_case(&name)) {
                folders.push(name.clone());
            }
            collect_outlines(child, Some(&name), folders, feeds_out);
        }
    }
}

pub fn import(conn: &Connection, path: &str) -> AppResult<OpmlImportResult> {
    let data = std::fs::read_to_string(path)?;
    import_str(conn, &data)
}

pub fn import_str(conn: &Connection, data: &str) -> AppResult<OpmlImportResult> {
    let data = data.trim_start_matches('\u{feff}');
    let doc = roxmltree::Document::parse(data)?;
    let body = doc
        .descendants()
        .find(|n| n.has_tag_name("body"))
        .ok_or_else(|| AppError::Message("OPML file has no body".into()))?;
    let mut folders: Vec<String> = Vec::new();
    let mut outlines: Vec<OutlineFeed> = Vec::new();
    collect_outlines(body, None, &mut folders, &mut outlines);

    let mut folder_ids: BTreeMap<String, i64> = BTreeMap::new();
    for (index, name) in folders.iter().enumerate() {
        let id = ensure_folder(conn, name, index as i64)?;
        folder_ids.insert(name.to_ascii_lowercase(), id);
    }

    let mut imported = 0;
    let mut skipped = 0;
    let mut failures = Vec::new();
    for outline in outlines {
        let normalized = match feeds::normalized_url(&outline.url) {
            Ok(u) => u,
            Err(e) => {
                failures.push(format!("{}: {}", outline.url, e));
                continue;
            }
        };
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM feeds WHERE url = ?1",
            params![normalized],
            |r| r.get(0),
        )?;
        if exists > 0 {
            skipped += 1;
            continue;
        }
        let folder_id = outline
            .folder
            .as_ref()
            .and_then(|name| folder_ids.get(&name.to_ascii_lowercase()).copied());
        match feeds::add_feed(
            conn,
            AddFeedArgs {
                url: normalized,
                folder_id,
                title: outline.title,
            },
        ) {
            Ok(feed) => {
                imported += 1;
                if feed.last_status == "error" {
                    failures.push(format!(
                        "{}: {}",
                        feed.title,
                        feed.error.unwrap_or_else(|| "Could not fetch feed".into())
                    ));
                }
            }
            Err(e) => failures.push(format!("{}: {}", outline.url, e)),
        }
    }
    Ok(OpmlImportResult {
        imported,
        skipped,
        failures,
    })
}

fn escape_attr(value: &str) -> String {
    html_escape::encode_double_quoted_attribute(value).to_string()
}

pub fn export(conn: &Connection, path: &str) -> AppResult<OpmlExportResult> {
    let mut stmt = conn.prepare(
        "SELECT f.title, f.url, f.site_url, fo.name FROM feeds f
         LEFT JOIN folders fo ON fo.id = f.folder_id
         ORDER BY fo.position ASC, fo.name COLLATE NOCASE ASC, f.title COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut grouped: BTreeMap<Option<String>, Vec<(String, String, Option<String>)>> =
        BTreeMap::new();
    let mut count = 0i64;
    for row in rows {
        let (title, url, site, folder) = row?;
        count += 1;
        grouped.entry(folder).or_default().push((title, url, site));
    }

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<opml version=\"2.0\">\n  <head>\n    <title>Tyler feeds</title>\n");
    xml.push_str(&format!("    <dateCreated>{}</dateCreated>\n", now_iso()));
    xml.push_str("  </head>\n  <body>\n");
    for (folder, feeds_in_folder) in grouped {
        if let Some(folder) = folder {
            xml.push_str(&format!(
                "    <outline text=\"{}\" title=\"{}\">\n",
                escape_attr(&folder),
                escape_attr(&folder)
            ));
            for (title, url, site) in feeds_in_folder {
                xml.push_str(&outline_feed(&title, &url, site.as_deref(), 6));
            }
            xml.push_str("    </outline>\n");
        } else {
            for (title, url, site) in feeds_in_folder {
                xml.push_str(&outline_feed(&title, &url, site.as_deref(), 4));
            }
        }
    }
    xml.push_str("  </body>\n</opml>\n");

    let path_buf = Path::new(path);
    if let Some(parent) = path_buf.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(path_buf, xml)?;
    Ok(OpmlExportResult { count })
}

fn outline_feed(title: &str, url: &str, site: Option<&str>, indent: usize) -> String {
    let pad = " ".repeat(indent);
    let html = site
        .map(|s| format!(" htmlUrl=\"{}\"", escape_attr(s)))
        .unwrap_or_default();
    format!(
        "{pad}<outline type=\"rss\" text=\"{}\" title=\"{}\" xmlUrl=\"{}\"{html}/>\n",
        escape_attr(title),
        escape_attr(title),
        escape_attr(url)
    )
}
