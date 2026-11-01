use super::*;

pub(super) async fn message(
    g: &mut Projection<'_>,
    action: &str,
    p: &Value,
    e: &Value,
) -> Result<(), IngestError> {
    if action == "deleted" {
        return g.cascade("MESSAGE", true, "").await;
    }
    let created = action == "created";
    let data = snapshot(p, if created { "message" } else { "update" })?;
    if !process(data)? {
        return Ok(());
    }
    let conversation = p["conversationId"]
        .as_str()
        .or(e["conversationId"].as_str());
    if created {
        let props = json!({"content":data["userMessage"].as_str().unwrap_or(""),"authorId":data["userId"].as_str().unwrap_or("unknown"),"conversationId":conversation,"messageType":data["type"].as_str().unwrap_or("USER")});
        g.node(g.id, "MESSAGE", props, false).await?;
        g.ensure(conversation, "CONVERSATION").await?;
        if let Some(conversation) = conversation {
            g.edge(
                conversation,
                g.id,
                "HAS_MESSAGE",
                "Conversation contains message",
                json!({}),
            )
            .await?;
        }
    } else {
        let mut props = json!({});
        if !data["systemMessage"].is_null() {
            props["content"] = data["systemMessage"].clone();
        }
        g.update("MESSAGE", props).await?;
    }
    let parent = data["parentMessageId"].as_str();
    let parent_snapshot = &data["parentMessage"];
    if let Some(parent_id) = parent_snapshot["id"].as_str().or(parent) {
        let props = json!({"content":parent_snapshot["content"].as_str().unwrap_or(""),"authorId":"unknown","messageType":"UNKNOWN","conversationId":conversation});
        g.node(parent_id, "MESSAGE", props, true).await?;
    }
    if let Some(parent) = parent {
        if !created {
            g.remove_edges("MESSAGE_FOLLOWS", true).await?;
        }
        g.edge(
            parent,
            g.id,
            "MESSAGE_FOLLOWS",
            if created {
                "Message temporally follows previous"
            } else {
                "Message thread rewired via prepend"
            },
            json!({}),
        )
        .await?;
    }
    Ok(())
}

pub(super) async fn report(g: &mut Projection<'_>, p: &Value) -> Result<(), IngestError> {
    if !process(p)? {
        return Ok(());
    }
    let data = snapshot(p, "report")?;
    if data["ragEnabled"] == false {
        return Ok(());
    }
    if data["id"].as_str().is_some_and(|id| id != g.id) {
        return Err(IngestError::rejected("report snapshot identity mismatch"));
    }
    let props = selected(
        data,
        &[
            "reportType",
            "audience",
            "title",
            "version",
            "schemaVersion",
            "sourceExecutionId",
            "expiresAt",
            "createdAt",
            "updatedAt",
        ],
    );
    g.node(g.id, "REPORT", props, false).await?;
    let project = g.scope.project.clone();
    g.ensure(Some(&project), "PROJECT").await?;
    if let Some(entities) = data["entities"].as_array() {
        for entity in entities {
            let id = required(entity, "entityId")?;
            let kind = required(entity, "entityType")?;
            g.ensure(Some(id), kind).await?;
            g.edge(
                g.id,
                id,
                "REPORTS_ON",
                "Report relates to entity",
                selected(entity, &["entityType", "relation"]),
            )
            .await?;
        }
    }
    Ok(())
}

pub(super) async fn mention(
    g: &mut Projection<'_>,
    action: &str,
    p: &Value,
    e: &Value,
) -> Result<(), IngestError> {
    if action == "removed" {
        sqlx::query("DELETE FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='MENTIONS' AND properties->>'mentionId'=$3").bind(&g.scope.organization).bind(&g.scope.project).bind(g.id).execute(&mut *g.tx).await.map_err(anyhow::Error::from)?;
        return Ok(());
    }
    let source = required(p, "sourceEntityId")?;
    let source_type = required(p, "sourceEntityType")?;
    let target = required(p, "entityId")?;
    let target_type = required(p, "entityType")?;
    let anchor = p["workflowAboutId"].as_str().unwrap_or(source);
    let anchor_type = p["workflowAboutType"].as_str().unwrap_or(source_type);
    g.ensure(Some(anchor), anchor_type).await?;
    g.ensure(Some(target), target_type).await?;
    let mut props = selected(
        p,
        &[
            "sourceEntityId",
            "sourceEntityType",
            "entityType",
            "messageId",
            "workflowAboutType",
        ],
    );
    props["mentionId"] = json!(g.id);
    props["organizationId"] = json!(g.scope.organization);
    props["projectId"] = json!(g.scope.project);
    props["conversationId"] = json!(
        p["conversationId"]
            .as_str()
            .or(e["conversationId"].as_str())
    );
    if !e["partitionKey"].is_null() {
        props["workflowId"] = e["partitionKey"].clone();
    }
    g.edge(
        anchor,
        target,
        "MENTIONS",
        "Workflow context mentions entity",
        props,
    )
    .await
}

pub(super) async fn name_uuid(g: &mut Projection<'_>, key: &str) -> Result<String, IngestError> {
    // java.util.UUID.nameUUIDFromBytes uses MD5 directly (no namespace).
    let digest: String = sqlx::query_scalar("SELECT md5($1)")
        .bind(key.to_lowercase())
        .fetch_one(&mut *g.tx)
        .await
        .map_err(anyhow::Error::from)?;
    let variant = u8::from_str_radix(&digest[16..17], 16).unwrap() & 3 | 8;
    Ok(format!(
        "{}-{}-3{}-{:x}{}-{}",
        &digest[..8],
        &digest[8..12],
        &digest[13..16],
        variant,
        &digest[17..20],
        &digest[20..]
    ))
}
pub(super) async fn summary(
    g: &mut Projection<'_>,
    action: &str,
    p: &Value,
) -> Result<(), IngestError> {
    let entity = required(p, "entityId")?;
    let category = required(p, "category")?;
    let category_id = name_uuid(g, &format!("{}:{category}", g.scope.project)).await?;
    if action != "created" {
        sqlx::query("DELETE FROM graph.edge e USING graph.edge cf WHERE e.organization_id=$1 AND e.project_id=$2 AND e.relationship_type='HAS_KB_ENTRY' AND e.target_id=$3 AND cf.organization_id=$1 AND cf.project_id=$2 AND cf.source_id=$4 AND cf.relationship_type='HAS_FACET' AND cf.target_id=e.source_id")
            .bind(&g.scope.organization).bind(&g.scope.project).bind(entity).bind(&category_id).execute(&mut *g.tx).await.map_err(anyhow::Error::from)?;
    }
    if action == "deleted" {
        return Ok(());
    }
    let kind = normalized(required(p, "entityType")?);
    let kind = if kind == "DESIGNDOC" {
        "DESIGN_DOC"
    } else {
        &kind
    };
    if !matches!(
        kind,
        "TASK" | "INITIATIVE" | "CONVERSATION" | "MESSAGE" | "DESIGN_DOC"
    ) {
        return Err(IngestError::rejected("unsupported summary entity type"));
    }
    g.ensure(Some(entity), kind).await?;
    let project = g.scope.project.clone();
    g.ensure(Some(&project), "PROJECT").await?;
    g.node(
        &category_id,
        "CATEGORY",
        json!({"name":category,"category":category}),
        true,
    )
    .await?;
    g.edge(
        &project,
        &category_id,
        "HAS_CATEGORY",
        "Project contains knowledge category",
        json!({"organizationId":g.scope.organization}),
    )
    .await?;
    if let Some(facets) = p["subfacets"].as_array() {
        for facet in facets {
            let facet = facet
                .as_str()
                .ok_or_else(|| IngestError::rejected("facet must be text"))?;
            if facet.trim().is_empty() {
                continue;
            }
            let id = name_uuid(g, &format!("{}:{category}:{facet}", g.scope.project)).await?;
            g.node(
                &id,
                "FACET",
                json!({"name":facet,"category":category}),
                true,
            )
            .await?;
            g.edge(
                &category_id,
                &id,
                "HAS_FACET",
                "Category contains facet",
                json!({"organizationId":g.scope.organization}),
            )
            .await?;
            g.edge(
                &id,
                entity,
                "HAS_KB_ENTRY",
                "Facet contains summary entry",
                json!({}),
            )
            .await?;
        }
    }
    Ok(())
}
