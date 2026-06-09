import { NextResponse } from "next/server";
import { getCachedRankingsData } from "@/lib/rankings-cache";

export async function GET() {
    try {
        const data = await getCachedRankingsData();

        // Aggregate quiz scores per user (matching default Quizzes tab on Leaderboard)
        const userMap = new Map<string, { userId: string; userName: string; score: number; testsTaken: number; lastSubmission: number }>();

        data.quizAttempts.forEach(attempt => {
            if (!attempt.userId) return;
            const existing = userMap.get(attempt.userId) || {
                userId: attempt.userId,
                userName: attempt.userName || "Student",
                score: 0,
                testsTaken: 0,
                lastSubmission: 0,
            };
            existing.score += Number(attempt.score) || 0;
            existing.testsTaken += 1;
            existing.lastSubmission = Math.max(existing.lastSubmission, Number(attempt.submittedAt) || 0);
            userMap.set(attempt.userId, existing);
        });

        // Sort and take top 3
        const top3 = Array.from(userMap.values())
            .sort((a, b) => b.score !== a.score ? b.score - a.score : a.lastSubmission - b.lastSubmission)
            .slice(0, 3)
            .map((e, i) => ({ ...e, rank: i + 1 }));

        return NextResponse.json(
            { top3, generatedAt: Date.now() },
            {
                status: 200,
                headers: {
                    "Cache-Control": "no-store, max-age=0, must-revalidate",
                },
            }
        );
    } catch (err: any) {
        console.error("[LEADERBOARD_TOP3]", err);
        return NextResponse.json({ top3: [], error: err.message }, { status: 500 });
    }
}
