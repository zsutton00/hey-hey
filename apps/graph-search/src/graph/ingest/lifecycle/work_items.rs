use super::*;

pub(super) async fn simple(
    g: &mut Projection<'_>,
    family: &str,
    action: &str,
    p: &Value,
) -> Result<(), IngestError> {
    let entity = family.to_uppercase();
    if action == "archived" || (family == "conversation" && action == "deleted") {
        return g
            .cascade(
                &entity,
                p["hardDelete"] == true,
                if action == "archived" {
                    "ARCHIVED"
                } else {
                    "DELETED"
                },
            )
            .await;
    }
    if family == "artifact" && action == "deleted" {
        return g
            .update(
                &entity,
                json!({"deleted":true,"deletedAt":g.timestamp,"status":"DELETED"}),
            )
            .await;
    }
    if action == "status_changed" {
        let mut props = json!({"status":required(p,"newStatus")?,"statusChangedAt":g.timestamp});
        required(p, "previousStatus")?;
        if family == "initiative" {
            props["previousStatus"] = p["previousStatus"].clone();
        }
        return g.update(&entity, props).await;
    }
    if action == "assigned" {
        return g
            .update(&entity, json!({"assigneeId":required(p,"assigneeId")?}))
            .await;
    }
    if action == "unassigned" {
        return g.update(&entity, json!({"assigneeId":null})).await;
    }
    let created = action == "created";
    let data = match (family, created) {
        ("design_doc", _) => snapshot(p, "designDoc")?,
        ("service", _) => snapshot(p, "service")?,
        ("conversation", true) => p,
        ("artifact", false) => &Value::Null,
        (_, true) => snapshot(p, family)?,
        (_, false) => snapshot(p, "update")?,
    };
    let fields: &[&str] = match family {
        "task" => &["name", "status", "priority", "assigneeId", "type", "tag"],
        "initiative" => &["name", "status", "priority"],
        "design_doc" => &["name", "status"],
        "service" => &[
            "name",
            "description",
            "status",
            "repositoryUrl",
            "repositoryType",
            "repositoryId",
            "serviceType",
            "language",
            "framework",
            "tags",
        ],
        "conversation" => &["title", "status"],
        "artifact" => &["title", "type"],
        _ => unreachable!(),
    };
    let mut props = selected(data, fields);
    if family == "design_doc" {
        props["title"] = props["name"].take();
        props.as_object_mut().unwrap().remove("name");
    }
    if family == "conversation" && created {
        props["title"] = p["conversationTitle"].clone();
    }
    if created && matches!(family, "task" | "service") {
        required(&props, "name")?;
    }
    if created {
        g.node(g.id, &entity, props, false).await?;
    } else {
        g.update(&entity, props).await?;
    }
    let project = g.scope.project.clone();
    g.ensure(Some(&project), "PROJECT").await?;
    match family {
        "task" => {
            let parent = data["parentTaskId"].as_str();
            g.ensure(parent, "TASK").await?;
            if let Some(parent) = parent {
                g.edge(
                    parent,
                    g.id,
                    "HAS_TASK",
                    if created {
                        "Task contains subtask"
                    } else {
                        "Task parent updated"
                    },
                    json!({}),
                )
                .await?;
            }
            if created {
                let initiative = p["initiativeId"].as_str();
                g.ensure(initiative, "INITIATIVE").await?;
                if let Some(initiative) = initiative {
                    g.edge(
                        initiative,
                        g.id,
                        "HAS_TASK",
                        "Initiative contains task",
                        json!({}),
                    )
                    .await?;
                }
                if data["type"] == "FEATURE" || (parent.is_none() && initiative.is_none()) {
                    g.edge(
                        g.id,
                        &project,
                        "SCOPED_TO_PROJECT",
                        "Task scoped to project",
                        json!({}),
                    )
                    .await?;
                }
            }
        }
        "initiative" if created => {
            g.edge(
                &project,
                g.id,
                "HAS_INITIATIVE",
                "Project contains initiative",
                json!({}),
            )
            .await?
        }
        "conversation" => {
            g.edge(
                g.id,
                &project,
                "SCOPED_TO_PROJECT",
                "Conversation scoped to project",
                json!({}),
            )
            .await?;
            if let (Some(id), Some(kind)) = (
                data["workflowAboutId"].as_str(),
                data["workflowAboutType"].as_str(),
            ) {
                g.ensure(Some(id), kind).await?;
                g.edge(
                    g.id,
                    id,
                    "ABOUT",
                    "Conversation discusses target entity",
                    json!({}),
                )
                .await?;
            }
        }
        "service" => {
            g.edge(
                g.id,
                &project,
                "SCOPED_TO_PROJECT",
                "Service scoped to project",
                json!({}),
            )
            .await?
        }
        "design_doc" if created => {
            g.edge(
                g.id,
                &project,
                "SCOPED_TO_PROJECT",
                "Design doc scoped to project",
                json!({}),
            )
            .await?
        }
        "artifact" if created => {
            g.edge(
                g.id,
                &project,
                "SCOPED_TO_PROJECT",
                "Artifact scoped to project",
                json!({}),
            )
            .await?;
            if let (Some(id), Some(kind)) = (data["sourceId"].as_str(), data["sourceType"].as_str())
                && matches!(kind, "CONVERSATION" | "INITIATIVE" | "TASK" | "MESSAGE")
            {
                g.ensure(Some(id), kind).await?;
                g.edge(
                    g.id,
                    id,
                    "DERIVES_FROM",
                    &format!("Artifact derived from {kind}"),
                    json!({}),
                )
                .await?;
            }
        }
        _ => {}
    }
    Ok(())
}
