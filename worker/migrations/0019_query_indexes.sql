CREATE INDEX IF NOT EXISTS idx_requests_status_priority_created
  ON requests(status, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_tasks_status_due_request
  ON request_tasks(status, due_date, request_id);

CREATE INDEX IF NOT EXISTS idx_request_events_request_created
  ON request_events(request_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_mailbox_folder_received
  ON email_messages(mailbox_email, folder, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_to_folder_received
  ON email_messages(to_address, folder, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_processed_request
  ON email_messages(processed_request_id);
