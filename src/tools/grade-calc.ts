// a local approximation of Canvas's course grade, used for breakdowns and
// what-if questions; Canvas stays the authority when it exposes a total

export interface GradeItem {
    id: string;
    name: string;
    points_possible: number;
    /** null while ungraded or unposted */
    score: number | null;
    excused: boolean;
}

export interface GradeGroup {
    id: string;
    name: string;
    weight: number;
    drop_lowest: number;
    drop_highest: number;
    never_drop: ReadonlySet<string>;
    items: GradeItem[];
}

export interface GroupResult {
    id: string;
    name: string;
    weight: number;
    earned: number;
    possible: number;
    percent: number | null;
    dropped: string[];
}

/**
 * `fill` decides what ungraded work is worth: undefined leaves it out
 * (Canvas's current score), a fraction counts it at that share of its points
 * (0 gives Canvas's final score).
 */
export function scoreGroup(group: GradeGroup, fill: number | undefined): GroupResult {
    const counted = group.items.flatMap((item) => {
        if (item.excused) return [];
        if (item.score !== null) return [{ item, score: item.score }];
        return fill === undefined ? [] : [{ item, score: fill * item.points_possible }];
    });

    // Canvas drops to maximise the grade; ranking by percentage matches that
    // whenever the dropped items share a points value
    const droppable = counted
        .filter(({ item }) => item.points_possible > 0 && !group.never_drop.has(item.id))
        .sort((a, b) => a.score / a.item.points_possible - b.score / b.item.points_possible);
    const maxDrops = Math.max(counted.length - 1, 0);
    const lowest = droppable.slice(0, Math.min(group.drop_lowest, maxDrops));
    const remainingDroppable = droppable.slice(lowest.length);
    const highest = remainingDroppable.slice(
        Math.max(remainingDroppable.length - Math.min(group.drop_highest, maxDrops - lowest.length), 0),
    );
    const dropped = new Set([...lowest, ...highest].map(({ item }) => item.id));

    const kept = counted.filter(({ item }) => !dropped.has(item.id));
    const earned = kept.reduce((sum, { score }) => sum + score, 0);
    const possible = kept.reduce((sum, { item }) => sum + item.points_possible, 0);
    return {
        id: group.id,
        name: group.name,
        weight: group.weight,
        earned,
        possible,
        percent: possible > 0 ? (earned / possible) * 100 : null,
        dropped: counted.filter(({ item }) => dropped.has(item.id)).map(({ item }) => item.name),
    };
}

/** groups without any points possible drop out, and weights rescale over the rest */
export function courseScore(groups: GradeGroup[], weighted: boolean, fill: number | undefined): number | null {
    const results = groups.map((group) => scoreGroup(group, fill));
    if (!weighted) {
        const possible = results.reduce((sum, result) => sum + result.possible, 0);
        const earned = results.reduce((sum, result) => sum + result.earned, 0);
        return possible > 0 ? (earned / possible) * 100 : null;
    }
    const included = results.filter((result) => result.percent !== null);
    const totalWeight = included.reduce((sum, result) => sum + result.weight, 0);
    if (totalWeight <= 0) return null;
    return included.reduce((sum, result) => sum + result.weight * (result.percent ?? 0), 0) / totalWeight;
}

/**
 * The average share of points needed on all ungraded work to finish on
 * `target` percent, or null when nothing is left to grade. Above 1 means
 * out of reach without extra credit; 0 or below means already secured.
 */
export function neededOnRemaining(groups: GradeGroup[], weighted: boolean, target: number): number | null {
    const remaining = groups.some((group) => group.items.some((item) => !item.excused && item.score === null));
    if (!remaining) return null;
    const atZero = courseScore(groups, weighted, 0);
    const atFull = courseScore(groups, weighted, 1);
    if (atZero === null || atFull === null || atFull === atZero) return null;
    return (target - atZero) / (atFull - atZero);
}
