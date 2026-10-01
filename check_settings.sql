SELECT 
  id, 
  length("documentContent") as camel_len, 
  length(document_content) as snake_len,
  "isActive" as is_active_camel,
  is_active as is_active_snake
FROM settings 
WHERE type = 'DOCUMENT';
