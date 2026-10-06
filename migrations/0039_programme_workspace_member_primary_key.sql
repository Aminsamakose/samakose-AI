ALTER TABLE "programme_workspace_members"
  DROP CONSTRAINT "programme_workspace_member_uq";

ALTER TABLE "programme_workspace_members"
  ADD CONSTRAINT "programme_workspace_member_pk" PRIMARY KEY ("workspace_id", "user_id", "role");
