-- Earlier visits were not retained separately; updated_at is the best legacy seed.
ALTER TABLE open_items ADD COLUMN last_activated_at TIMESTAMP(3);
UPDATE open_items SET last_activated_at = updated_at;
ALTER TABLE open_items ALTER COLUMN last_activated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE open_items ALTER COLUMN last_activated_at SET NOT NULL;

-- Trim legacy collections once, without ever deleting protected entries.
-- If protected entries alone exceed 100, they remain and new additions refuse.
WITH collection_sizes AS (
  SELECT collection_id, count(*) AS open_count
  FROM open_items WHERE removed_at IS NULL GROUP BY collection_id
), candidates AS (
  SELECT item.id, item.collection_id, sizes.open_count,
    row_number() OVER (PARTITION BY item.collection_id ORDER BY item.last_activated_at, item.id) AS oldest
  FROM open_items item JOIN collection_sizes sizes USING (collection_id)
  WHERE item.removed_at IS NULL AND NOT item.pinned
    AND item.note IS NULL AND item.group_id IS NULL AND sizes.open_count > 100
), trimmed AS (
  UPDATE open_items item
  SET removed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
      revision = collection.revision + 1
  FROM candidates candidate, open_item_collections collection
  WHERE item.id = candidate.id AND collection.id = candidate.collection_id
    AND candidate.oldest <= candidate.open_count - 100
  RETURNING item.collection_id
)
UPDATE open_item_collections collection
SET revision = collection.revision + 1, updated_at = CURRENT_TIMESTAMP
WHERE collection.id IN (SELECT collection_id FROM trimmed);
