# Canvas MCP tool manifest

This is the checked-in inventory for the runtime registry in `src/tools/index.ts`. It contains only tools that are registered by `src/server.ts`; it does not list planned, removed, or commented-out operations. The current catalog has **130 tools across 16 source modules** (the 15 Canvas workflow modules plus Canvas Progress).

Use MCP `tools/list` for the authoritative live descriptions, input schemas, titles, and safety annotations. This file is intentionally a compact name-level inventory so it stays auditable when Canvas's request fields evolve.

## Contract notes

- Canvas resource IDs are string-safe. Pass a decimal string for any Canvas ID; safe legacy numeric input remains accepted where applicable.
- List tools use Canvas pagination where the underlying endpoint supports it. JSON results provide both structured MCP content and a JSON text fallback.
- `canvas_bulk_update_assignment_dates` returns Canvas's asynchronous Progress object. Use `canvas_get_progress` with its ID to monitor completion.
- `canvas_get_conversation` explicitly avoids Canvas's default “mark as read on fetch” behavior.
- `canvas_upload_file` returns an explicit MCP error because it cannot perform Canvas's external three-step file-upload flow. `canvas_download_file_to_disk` also returns an explicit error rather than writing to disk, while including a Canvas download URL when one is available.
- Canvas permissions, not this catalog, determine whether a token may perform a mutating operation. Consult the [official Canvas REST documentation](https://developerdocs.instructure.com/services/canvas) for tenant-specific behavior and permissions.

## Registered tools

### Courses (4)

`canvas_list_courses`, `canvas_get_course`, `canvas_list_sections`, `canvas_create_course`

### Assignments and progress (11)

`canvas_list_assignments`, `canvas_get_assignment`, `canvas_list_assignment_groups`, `canvas_list_missing_assignments`, `canvas_create_assignment`, `canvas_update_assignment`, `canvas_delete_assignment`, `canvas_create_assignment_group`, `canvas_bulk_update_assignment_dates`, `canvas_assign_peer_review`, `canvas_get_progress`

### Submissions (10)

`canvas_get_my_submission`, `canvas_list_my_submissions`, `canvas_get_submission_comments`, `canvas_list_peer_reviews_todo`, `canvas_list_peer_reviews_for_assignment`, `canvas_submit_assignment`, `canvas_grade_submission`, `canvas_bulk_grade_submissions`, `canvas_post_submission_comment`, `canvas_list_section_submissions`

### Grades (6)

`canvas_get_my_grades`, `canvas_get_assignment_feedback`, `canvas_get_grading_standards`, `canvas_submit_grade`, `canvas_get_all_students_status`, `canvas_get_comprehensive_status`

### Modules (14)

`canvas_list_modules`, `canvas_get_module`, `canvas_list_module_items`, `canvas_get_module_item`, `canvas_get_module_item_sequence`, `canvas_mark_module_item_read`, `canvas_mark_module_item_done`, `canvas_create_module`, `canvas_update_module`, `canvas_delete_module`, `canvas_add_module_item`, `canvas_update_module_item`, `canvas_delete_module_item`, `canvas_toggle_module_publish`

### Pages (9)

`canvas_list_pages`, `canvas_get_page`, `canvas_get_front_page`, `canvas_list_page_revisions`, `canvas_get_page_revision`, `canvas_create_page`, `canvas_update_page`, `canvas_delete_page`, `canvas_revert_page_revision`

### Calendar and planner (11)

`canvas_list_calendar_events`, `canvas_list_upcoming_events`, `canvas_list_planner_items`, `canvas_list_todo_items`, `canvas_create_calendar_event`, `canvas_update_calendar_event`, `canvas_delete_calendar_event`, `canvas_create_planner_note`, `canvas_update_planner_note`, `canvas_delete_planner_note`, `canvas_mark_planner_item_complete`

### Announcements (7)

`canvas_list_announcements`, `canvas_list_course_announcements`, `canvas_get_announcement`, `canvas_list_account_notifications`, `canvas_create_announcement`, `canvas_delete_announcement`, `canvas_bulk_delete_announcements`

### Discussions (9)

`canvas_list_discussion_topics`, `canvas_get_discussion_topic`, `canvas_get_discussion_view`, `canvas_list_discussion_entries`, `canvas_get_discussion_entry`, `canvas_create_discussion_topic`, `canvas_post_discussion_entry`, `canvas_reply_to_discussion_entry`, `canvas_delete_discussion_topic`

### Files (8)

`canvas_list_course_files`, `canvas_list_folders`, `canvas_list_folder_files`, `canvas_get_file`, `canvas_get_file_download_url`, `canvas_upload_file`, `canvas_delete_file`, `canvas_download_file_to_disk`

### Messages (8)

`canvas_list_conversations`, `canvas_get_conversation`, `canvas_get_unread_count`, `canvas_mark_conversation_read`, `canvas_send_conversation`, `canvas_reply_to_conversation`, `canvas_send_bulk_messages`, `canvas_delete_conversation`

### Notifications (5)

`canvas_list_activity_stream`, `canvas_get_activity_stream_summary`, `canvas_list_communication_channels`, `canvas_dismiss_account_notification`, `canvas_update_notification_preference`

### Profile and settings (6)

`canvas_get_my_profile`, `canvas_get_user_profile`, `canvas_get_my_settings`, `canvas_update_user_profile`, `canvas_update_my_settings`, `canvas_create_user`

### Quizzes (13)

`canvas_list_quizzes`, `canvas_get_quiz`, `canvas_list_my_quiz_submissions`, `canvas_get_my_quiz_submission`, `canvas_create_quiz`, `canvas_update_quiz`, `canvas_delete_quiz`, `canvas_list_quiz_questions`, `canvas_create_quiz_question`, `canvas_update_quiz_question`, `canvas_delete_quiz_question`, `canvas_list_quiz_question_groups`, `canvas_start_quiz_attempt`

### Rubrics (9)

`canvas_list_rubrics`, `canvas_get_rubric`, `canvas_get_rubric_statistics`, `canvas_get_my_rubric_assessment`, `canvas_create_rubric`, `canvas_update_rubric`, `canvas_delete_rubric`, `canvas_associate_rubric`, `canvas_grade_with_rubric`
