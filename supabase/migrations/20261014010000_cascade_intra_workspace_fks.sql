-- Deleting a workspace (server-side, service role) cascades through every table. NO ACTION foreign keys between
-- sibling rows (e.g. verifications -> measurements) are checked mid-cascade and abort the delete, so they cascade
-- too. Optional links (revision parent, source artifact) set only their own column to NULL.
-- Clients have no delete policies, so this changes nothing for client requests.

alter table design_revisions
  drop constraint design_revisions_project_id_parent_id_fkey,
  add constraint design_revisions_project_id_parent_id_fkey foreign key (project_id, parent_id) references design_revisions (project_id, id) on delete set null (parent_id),
  drop constraint design_revisions_workspace_id_source_artifact_id_fkey,
  add constraint design_revisions_workspace_id_source_artifact_id_fkey foreign key (workspace_id, source_artifact_id) references artifacts (workspace_id, id) on delete set null (source_artifact_id);

alter table investigations
  drop constraint investigations_project_id_revision_id_fkey,
  add constraint investigations_project_id_revision_id_fkey foreign key (project_id, revision_id) references design_revisions (project_id, id) on delete cascade;

alter table measurements
  drop constraint measurements_investigation_id_revision_id_fkey,
  add constraint measurements_investigation_id_revision_id_fkey foreign key (investigation_id, revision_id) references investigations (id, revision_id) on delete cascade,
  drop constraint measurements_investigation_id_supersedes_fkey,
  add constraint measurements_investigation_id_supersedes_fkey foreign key (investigation_id, supersedes) references measurements (investigation_id, id) on delete cascade;

alter table hypotheses
  drop constraint hypotheses_investigation_id_revision_id_fkey,
  add constraint hypotheses_investigation_id_revision_id_fkey foreign key (investigation_id, revision_id) references investigations (id, revision_id) on delete cascade;

alter table repair_proposals
  drop constraint repair_proposals_investigation_id_revision_id_fkey,
  add constraint repair_proposals_investigation_id_revision_id_fkey foreign key (investigation_id, revision_id) references investigations (id, revision_id) on delete cascade,
  drop constraint repair_proposals_workspace_id_hypothesis_id_fkey,
  add constraint repair_proposals_workspace_id_hypothesis_id_fkey foreign key (workspace_id, hypothesis_id) references hypotheses (workspace_id, id) on delete cascade;

alter table verifications
  drop constraint verifications_workspace_id_measurement_id_fkey,
  add constraint verifications_workspace_id_measurement_id_fkey foreign key (workspace_id, measurement_id) references measurements (workspace_id, id) on delete cascade;

alter table reports
  drop constraint reports_investigation_id_revision_id_fkey,
  add constraint reports_investigation_id_revision_id_fkey foreign key (investigation_id, revision_id) references investigations (id, revision_id) on delete cascade,
  drop constraint reports_workspace_id_artifact_id_fkey,
  add constraint reports_workspace_id_artifact_id_fkey foreign key (workspace_id, artifact_id) references artifacts (workspace_id, id) on delete cascade;
