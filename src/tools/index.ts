import type { ToolDef } from "./types.js";
import { courseTools } from "./courses.js";
import { assignmentTools } from "./assignments.js";
import { submissionTools } from "./submissions.js";
import { gradeTools } from "./grades.js";
import { moduleTools } from "./modules.js";
import { pageTools } from "./pages.js";
import { calendarTools } from "./calendar.js";
import { announcementTools } from "./announcements.js";
import { discussionTools } from "./discussions.js";
import { fileTools } from "./files.js";

export const allTools: ToolDef[] = [
    ...courseTools,
    ...assignmentTools,
    ...submissionTools,
    ...gradeTools,
    ...moduleTools,
    ...pageTools,
    ...calendarTools,
    ...announcementTools,
    ...discussionTools,
    ...fileTools,
    // messages, notifications,
    // profile, quizzes, rubrics — added per-domain in later tasks.
];
