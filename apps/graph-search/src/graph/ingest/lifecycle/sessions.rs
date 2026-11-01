use super::*;

pub(super) async fn session(
    g: &mut Projection<'_>,
    action: &str,
    p: &Value,
    e: &Value,
) -> Result<(), IngestError> {
    if action == "deleted" {
        return g.cascade("AGENT_SESSION", false, "DELETED").await;
    }
    if action == "status_changed" {
        let mut props = selected(p, &["type"]);
        props["status"] = p["newStatus"]
            .as_str()
            .or(p["agentSession"]["status"].as_str())
            .map(|s| json!(s))
            .unwrap_or(Value::Null);
        if props["status"].is_null() {
            props.as_object_mut().unwrap().remove("status");
        }
        return g.update("AGENT_SESSION", props).await;
    }
    let data = snapshot(p, "agentSession")?;
    if data["id"].as_str().is_some_and(|id| id != g.id) {
        return Err(IngestError::rejected("session snapshot identity mismatch"));
    }
    let mut props = selected(
        data,
        &[
            "userId",
            "status",
            "sessionDate",
            "title",
            "provider",
            "agentSessionId",
            "createdAt",
            "updatedAt",
        ],
    );
    let conversation = p["conversationId"]
        .as_str()
        .or(data["conversationId"].as_str())
        .or(e["conversationId"].as_str());
    props["conversationId"] = json!(conversation);
    props["type"] = p["type"].clone();
    for (field, kind) in [
        ("taskId", "TASK"),
        ("initiativeId", "INITIATIVE"),
        ("designDocId", "DESIGN_DOC"),
    ] {
        props[field] = if data["entityType"] == kind {
            data["entityId"].clone()
        } else {
            Value::Null
        };
    }
    if !p["taskId"].is_null() {
        props["taskId"] = p["taskId"].clone();
    }
    props["serviceId"] = p["serviceId"]
        .as_str()
        .or(data["launchServiceId"].as_str())
        .map(|s| json!(s))
        .unwrap_or(Value::Null);
    props["planId"] = p["planId"].clone();
    g.node(g.id, "AGENT_SESSION", props.clone(), false).await?;
    let project = g.scope.project.clone();
    g.ensure(Some(&project), "PROJECT").await?;
    g.ensure(conversation, "CONVERSATION").await?;
    // The handler ensures fallback endpoints, but the mapper authors links only
    // for explicit taskId/serviceId/planId payload fields.
    g.ensure(props["taskId"].as_str(), "TASK").await?;
    g.ensure(props["serviceId"].as_str(), "SERVICE").await?;
    g.ensure(p["planId"].as_str(), "TASK").await?;
    let base = json!({"conversationId":conversation,"organizationId":g.scope.organization,"projectId":g.scope.project});
    let mut linked = false;
    for (field, entity, reason) in [
        ("taskId", "TASK", "Task has agent session"),
        ("serviceId", "SERVICE", "Service has agent session"),
        ("planId", "TASK", "Plan task has agent session"),
    ] {
        if field == "planId" && p[field] == p["taskId"] {
            continue;
        }
        if let Some(id) = p[field].as_str() {
            linked = true;
            g.ensure(Some(id), entity).await?;
            let mut extra = base.clone();
            if field == "planId" {
                extra["planId"] = json!(id);
                extra["planScope"] = json!("PLAN");
            }
            g.edge(id, g.id, "HAS_AGENT_SESSION", reason, extra).await?;
        }
    }
    if let Some(conversation) = conversation {
        g.edge(
            conversation,
            g.id,
            "ABOUT",
            "Conversation discusses agent session",
            base.clone(),
        )
        .await?;
    }
    if !linked {
        g.edge(
            g.id,
            &project,
            "SCOPED_TO_PROJECT",
            "Agent session scoped to project",
            base,
        )
        .await?;
    }
    Ok(())
}

pub(super) async fn hint(
    g: &mut Projection<'_>,
    action: &str,
    p: &Value,
    e: &Value,
) -> Result<(), IngestError> {
    if action == "deleted" {
        return g.cascade("IMPLEMENTATION_HINT", false, "DELETED").await;
    }
    let data = snapshot(p, "implementationHint")?;
    if data["id"].as_str().is_some_and(|id| id != g.id) {
        return Err(IngestError::rejected("hint snapshot identity mismatch"));
    }
    let mut props = selected(
        data,
        &[
            "serviceId",
            "featureName",
            "description",
            "sourceType",
            "hint",
            "extractedFrom",
            "confidence",
            "version",
            "agentSessionId",
            "createdAt",
            "updatedAt",
        ],
    );
    // Unlike partial updates, a hint event carries a replacement snapshot.
    // Neo4j removes properties whose snapshot value is null.
    for field in [
        "serviceId",
        "featureName",
        "description",
        "sourceType",
        "hint",
        "extractedFrom",
        "confidence",
        "version",
        "agentSessionId",
    ] {
        props[field] = data[field].clone();
    }
    props["contextKeys"] = json!(
        data["context"]
            .as_object()
            .map(|m| m.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default()
    );
    props["fileReferenceCount"] = json!(data["fileReferences"].as_array().map_or(0, Vec::len));
    props["versionCount"] = json!(data["versions"].as_array().map_or(0, Vec::len));
    if action == "created" {
        g.node(g.id, "IMPLEMENTATION_HINT", props, false).await?;
    } else {
        g.update("IMPLEMENTATION_HINT", props).await?;
        g.remove_edges("HAS_IMPLEMENTATION_HINT", true).await?;
        g.remove_edges("DERIVES_FROM", false).await?;
    }
    let project = g.scope.project.clone();
    g.ensure(Some(&project), "PROJECT").await?;
    let service = data["serviceId"].as_str();
    let session = data["agentSessionId"].as_str();
    g.ensure(service, "SERVICE").await?;
    g.ensure(session, "AGENT_SESSION").await?;
    let base = json!({"conversationId":p["conversationId"].as_str().or(e["conversationId"].as_str()),"organizationId":g.scope.organization,"projectId":g.scope.project});
    if let Some(service) = service {
        g.edge(
            service,
            g.id,
            "HAS_IMPLEMENTATION_HINT",
            "Service has implementation hint",
            base.clone(),
        )
        .await?;
    }
    if let Some(session) = session {
        let mut extra = base;
        extra["derivationType"] = json!("AGENT_SESSION");
        g.edge(
            g.id,
            session,
            "DERIVES_FROM",
            "Implementation hint derived from agent session",
            extra,
        )
        .await?;
    }
    Ok(())
}
