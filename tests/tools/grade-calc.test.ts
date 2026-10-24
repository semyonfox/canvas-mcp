import { describe, expect, it, vi } from "vitest";
import type { CanvasClient } from "../../src/canvas/client.js";
import { courseScore, type GradeGroup, neededOnRemaining, scoreGroup } from "../../src/tools/grade-calc.js";
import { gradeTools } from "../../src/tools/grades.js";

const item = (id: string, points_possible: number, score: number | null, excused = false) =>
    ({ id, name: id, points_possible, score, excused });

const group = (overrides: Partial<GradeGroup> & Pick<GradeGroup, "items">): GradeGroup => ({
    id: overrides.id ?? "g",
    name: overrides.name ?? "Group",
    weight: 0,
    drop_lowest: 0,
    drop_highest: 0,
    never_drop: new Set(),
    ...overrides,
});

describe("grade calculation", () => {
    it("separates current (graded only) from final (ungraded as zero) and skips excused work", () => {
        const labs = group({ items: [item("a", 10, 8), item("b", 10, null), item("c", 10, null, true)] });
        expect(scoreGroup(labs, undefined)).toMatchObject({ earned: 8, possible: 10, percent: 80 });
        expect(scoreGroup(labs, 0)).toMatchObject({ earned: 8, possible: 20, percent: 40 });
    });

    it("drops the lowest and highest by percentage but respects never_drop and keeps one item", () => {
        const labs = group({
            drop_lowest: 1,
            drop_highest: 1,
            never_drop: new Set(["low"]),
            items: [item("low", 10, 1), item("mid", 10, 5), item("hi", 10, 10), item("mid2", 10, 6)],
        });
        const result = scoreGroup(labs, undefined);
        expect(result.dropped).toEqual(["mid", "hi"]);
        expect(result).toMatchObject({ earned: 7, possible: 20 });

        const single = group({ drop_lowest: 3, items: [item("only", 10, 2)] });
        expect(scoreGroup(single, undefined).dropped).toEqual([]);
    });

    it("rescales weights over groups that have graded work", () => {
        const groups = [
            group({ id: "labs", weight: 40, items: [item("a", 10, 9)] }),
            group({ id: "exam", weight: 60, items: [item("e", 100, null)] }),
        ];
        expect(courseScore(groups, true, undefined)).toBeCloseTo(90);
        expect(courseScore(groups, true, 0)).toBeCloseTo(36);
        expect(courseScore(groups, false, undefined)).toBeCloseTo(90);
    });

    it("solves for the average needed on remaining work", () => {
        const groups = [
            group({ id: "labs", weight: 40, items: [item("a", 10, 9)] }),
            group({ id: "exam", weight: 60, items: [item("e", 100, null)] }),
        ];
        // 36 + 60x = 70 -> x = 34/60
        expect(neededOnRemaining(groups, true, 70)).toBeCloseTo(34 / 60);
        expect(neededOnRemaining([group({ items: [item("a", 10, 9)] })], false, 70)).toBeNull();
    });
});

describe("canvas_get_my_grade_breakdown", () => {
    const groups = [
        {
            id: "1",
            name: "Labs",
            group_weight: 40,
            rules: {},
            assignments: [
                { id: "11", name: "Lab 1", points_possible: 10, submission: { score: 9 } },
                { id: "12", name: "Lab 2", points_possible: 10, submission: { score: null } },
                { id: "13", name: "Practice", points_possible: 10, omit_from_final_grade: true, submission: { score: 0 } },
            ],
        },
        {
            id: "2",
            name: "Exam",
            group_weight: 60,
            rules: null,
            assignments: [{ id: "21", name: "Final", points_possible: 100, submission: null }],
        },
    ];

    async function run(args: Record<string, unknown>) {
        const tool = gradeTools.find((t) => t.name === "canvas_get_my_grade_breakdown")!;
        const canvas = {
            get: vi.fn().mockResolvedValue({
                apply_assignment_group_weights: true,
                enrollments: [{ type: "student", computed_current_score: 90 }],
            }),
            collectPaginated: vi.fn().mockResolvedValue(groups),
        } as unknown as CanvasClient;
        return (await tool.handler(tool.inputSchema.parse(args), { canvas })).structuredContent as Record<string, unknown>;
    }

    it("reports weighted current and final percentages next to Canvas's own total", async () => {
        const body = await run({ course_id: "5" });
        expect(body).toMatchObject({ weighted: true, current_percent: 90, final_percent: 18, canvas_current_score: 90 });
        expect(body.groups).toEqual([
            { name: "Labs", weight: 40, current_percent: 90, earned: 9, possible: 10, ungraded: 1, dropped: [] },
            { name: "Exam", weight: 60, current_percent: null, earned: 0, possible: 0, ungraded: 1, dropped: [] },
        ]);
    });

    it("applies what-if scores and reports the average needed for a target", async () => {
        const body = await run({
            course_id: "5",
            what_if: [{ assignment_id: "12", score: 10 }, { assignment_id: "999", score: 1 }],
            target_percent: 70,
        });
        expect(body.what_if_applied).toEqual(["Lab 2"]);
        expect(body.what_if_not_found).toEqual(["999"]);
        // labs are now 19/20 = 95% -> 38 points of weight; 38 + 60x = 70
        expect(body.target).toEqual({ target_percent: 70, needed_percent_on_remaining: 53.33, status: "reachable" });
    });
});
