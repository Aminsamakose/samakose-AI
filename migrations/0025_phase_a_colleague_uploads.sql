-- Fast "my uploads" for a colleague and the owner review list in a team round. No new table: colleague uploads are ordinary documents of the business, stored by the existing upload checks.
CREATE INDEX "doc_uploader_idx" ON "documents" USING btree ("org_id","uploaded_by");
