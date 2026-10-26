-- §13 architecture review: Supabase's performance advisor flagged 133 foreign-key columns across the
-- schema with no covering index. An uncovered FK means every join, cascading update/delete and
-- RESTRICT check against that column does a full table scan, and the scan gets worse as each table
-- grows -- the exact kind of problem that is cheap to fix now and expensive to diagnose later under
-- real load. All of these are plain, additive B-tree indexes with no behavioural change, so they are
-- safe to apply as one batch. Audit-trail columns (created_by, approved_by, etc.) are included even
-- though they are rarely queried today, because they are exactly the columns a future reporting or
-- audit feature will filter on, and adding the index later means a lock on a much bigger table.
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_coach_id ON public.coaching_sessions (coach_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_practitioner_conflicts_org_id ON public.practitioner_conflicts (org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_practitioner_conflicts_declared_by ON public.practitioner_conflicts (declared_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_approval_decisions_decided_by ON public.approval_decisions (decided_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_promo_campaigns_discount_rule_id ON public.promo_campaigns (discount_rule_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_opportunities_published_by ON public.opportunities (published_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_opportunities_created_by ON public.opportunities (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_area_assignments_member_id ON public.area_assignments (member_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_area_assignments_confirmed_by ON public.area_assignments (confirmed_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_org_members_invited_by ON public.org_members (invited_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contract_amendments_created_by ON public.contract_amendments (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_case_message_reads_user_id ON public.case_message_reads (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_invoice_id ON public.promo_redemptions (invoice_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_customer_id ON public.promo_redemptions (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_interventions_prescription_id ON public.interventions (prescription_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_opportunity_referrals_suggested_by ON public.opportunity_referrals (suggested_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_opportunity_referrals_opportunity_id ON public.opportunity_referrals (opportunity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_opportunity_referrals_consent_by ON public.opportunity_referrals (consent_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_opportunity_referrals_approved_by ON public.opportunity_referrals (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payout_holds_resolved_by ON public.payout_holds (resolved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payout_holds_created_by ON public.payout_holds (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_framework_questions_created_by ON public.framework_questions (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_provider_assignments_created_by ON public.provider_assignments (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_practitioner_profiles_decided_by ON public.practitioner_profiles (decided_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_health_scores_framework_version_id ON public.health_scores (framework_version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_health_scores_diagnostic_id ON public.health_scores (diagnostic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_case_messages_sender_id ON public.case_messages (sender_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by ON public.calendar_events (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_sessions_created_by ON public.delivery_sessions (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_tranches_created_by ON public.programme_tranches (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_session_id ON public.delivery_tasks (session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_created_by ON public.delivery_tasks (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_activity_id ON public.delivery_tasks (activity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_activities_owner_user_id ON public.delivery_activities (owner_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_activities_created_by ON public.delivery_activities (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_library_authors_user_id ON public.library_authors (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_library_authors_photo_media_id ON public.library_authors (photo_media_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tax_lines_tax_rule_id ON public.tax_lines (tax_rule_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_consents_org_id ON public.consents (org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_consents_notice_id ON public.consents (notice_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_registration_answers_org_id ON public.registration_answers (org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_revenue_share_calculations_supersedes_id ON public.revenue_share_calculations (supersedes_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_revenue_share_calculations_payment_id ON public.revenue_share_calculations (payment_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_revenue_share_calculations_approved_by ON public.revenue_share_calculations (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_feedback_org_id ON public.feedback (org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_feedback_health_score_id ON public.feedback (health_score_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_feedback_handled_by ON public.feedback (handled_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_feedback_case_id ON public.feedback (case_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_workspace_configurations_framework_version_id ON public.programme_workspace_configurations (framework_version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_workspace_configurations_created_by ON public.programme_workspace_configurations (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_workspace_configurations_approved_by ON public.programme_workspace_configurations (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_public_assessments_framework_version_id ON public.public_assessments (framework_version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ai_attempts_request_id ON public.ai_attempts (request_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_milestones_owner_user_id ON public.delivery_milestones (owner_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_milestones_created_by ON public.delivery_milestones (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programmes_logo_media_id ON public.programmes (logo_media_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ai_agents_owner_id ON public.ai_agents (owner_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_approval_requests_requested_by ON public.approval_requests (requested_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contracts_programme_id ON public.contracts (programme_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contracts_plan_id ON public.contracts (plan_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contracts_accepted_by ON public.contracts (accepted_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_organisations_merged_into ON public.organisations (merged_into);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_organisations_geo_unit_id ON public.organisations (geo_unit_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_organisations_country_code ON public.organisations (country_code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_tokens_user_id ON public.user_tokens (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_library_resources_created_by ON public.library_resources (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_library_resources_cover_media_id ON public.library_resources (cover_media_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_library_resources_approved_by ON public.library_resources (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_case_assignments_assigned_by ON public.case_assignments (assigned_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prescriptions_diagnosis_id ON public.prescriptions (diagnosis_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_opportunity_referral_events_actor_id ON public.opportunity_referral_events (actor_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_opportunity_sources_created_by ON public.opportunity_sources (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_participants_merged_into ON public.participants (merged_into);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_participants_created_by ON public.participants (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assessment_rounds_owner_id ON public.assessment_rounds (owner_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assessment_rounds_org_id ON public.assessment_rounds (org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assessment_rounds_framework_version_id ON public.assessment_rounds (framework_version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assessment_rounds_diagnostic_id ON public.assessment_rounds (diagnostic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_demographic_profiles_consent_id ON public.demographic_profiles (consent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_role_mappings_created_by ON public.role_mappings (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_role_mappings_approved_by ON public.role_mappings (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_exceptions_task_id ON public.delivery_exceptions (task_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_exceptions_session_id ON public.delivery_exceptions (session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_exceptions_created_by ON public.delivery_exceptions (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_exceptions_activity_id ON public.delivery_exceptions (activity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_workspaces_framework_version_id ON public.programme_workspaces (framework_version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_ledger_entry_id ON public.payout_adjustments (ledger_entry_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_created_by ON public.payout_adjustments (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_approved_by ON public.payout_adjustments (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_revenue_share_agreements_proposed_by ON public.revenue_share_agreements (proposed_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_revenue_share_agreements_approved_by ON public.revenue_share_agreements (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_participants_organisation_id ON public.programme_participants (organisation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_participants_consent_by ON public.programme_participants (consent_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_resource_entitlements_invoice_id ON public.resource_entitlements (invoice_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_resource_entitlements_granted_by ON public.resource_entitlements (granted_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refunds_requested_by ON public.refunds (requested_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refunds_ledger_entry_id ON public.refunds (ledger_entry_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refunds_invoice_id ON public.refunds (invoice_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refunds_approved_by ON public.refunds (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_indicators_parent_id ON public.programme_indicators (parent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_indicators_created_by ON public.programme_indicators (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_budget_lines_created_by ON public.programme_budget_lines (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_document_id ON public.evidence (document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_versions_created_by ON public.programme_versions (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_versions_approved_by ON public.programme_versions (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_expenditures_created_by ON public.programme_expenditures (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_programme_expenditures_cohort_id ON public.programme_expenditures (cohort_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_financial_periods_closed_by ON public.financial_periods (closed_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_discount_rules_created_by ON public.discount_rules (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_discount_rules_approved_by ON public.discount_rules (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_delivery_attendance_recorded_by ON public.delivery_attendance (recorded_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_certificates_score_id ON public.certificates (score_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_certificates_revoked_by ON public.certificates (revoked_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_certificates_proposed_by ON public.certificates (proposed_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_certificates_framework_version_id ON public.certificates (framework_version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_certificates_decided_by ON public.certificates (decided_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_professional_payouts_reviewed_by ON public.professional_payouts (reviewed_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_professional_payouts_contract_id ON public.professional_payouts (contract_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_professional_payouts_assignment_id ON public.professional_payouts (assignment_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_professional_payouts_approved_by ON public.professional_payouts (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_provider_capacities_created_by ON public.provider_capacities (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cohort_configurations_created_by ON public.cohort_configurations (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cohort_configurations_approved_by ON public.cohort_configurations (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_consent_notices_created_by ON public.consent_notices (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_consent_notices_country_code ON public.consent_notices (country_code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_actions_intervention_id ON public.actions (intervention_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_revenue_share_allocations_professional_id ON public.revenue_share_allocations (professional_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_framework_source_records_approved_by ON public.framework_source_records (approved_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_diagnostics_framework_version_id ON public.diagnostics (framework_version_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outcome_records_verified_by ON public.outcome_records (verified_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outcome_records_document_id ON public.outcome_records (document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outcome_records_created_by ON public.outcome_records (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_engagement_ratings_rater_id ON public.engagement_ratings (rater_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_response_drafts_answered_by ON public.response_drafts (answered_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_integration_credentials_updated_by ON public.integration_credentials (updated_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_programmes_programme_id ON public.user_programmes (programme_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_free_assessment_owners_added_by ON public.free_assessment_owners (added_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outcome_definitions_created_by ON public.outcome_definitions (created_by);
