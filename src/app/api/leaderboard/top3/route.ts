import { NextResponse } from "next/server";
import { getCachedRankingsData } from "@/lib/rankings-cache";

export async function GET() {
    try {
        const data = await getCachedRankingsData();

        // Step 1: Deduplicate quiz attempts per (userId, quizId) — keep best score per user per quiz
        const bestPerUserQuiz = new Map<string, typeof data.quizAttempts[0]>();
        data.quizAttempts.forEach(attempt => {
            if (!attempt.userId) return;
            const compositeKey = `${attempt.userId}__${attempt.quizId || ""}`;
            const aScore = Number(attempt.score) || 0;
            const aTime = Number(attempt.submittedAt) || 0;
            const existing = bestPerUserQuiz.get(compositeKey);
            if (!existing) {
                bestPerUserQuiz.set(compositeKey, attempt);
            } else {
                const exScore = Number(existing.score) || 0;
                const exTime = Number(existing.submittedAt) || 0;
                if (aScore > exScore || (aScore === exScore && aTime < exTime)) {
                    bestPerUserQuiz.set(compositeKey, attempt);
                }
            }
        });

        // Step 2: Aggregate deduplicated best scores per user across quizzes
        const userMap = new Map<string, { userId: string; userName: string; score: number; testsTaken: number; lastSubmission: number }>();

        bestPerUserQuiz.forEach(attempt => {
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
                    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
                },
            }
        );
    } catch (err: any) {
        console.error("[LEADERBOARD_TOP3]", err);
        return NextResponse.json({ top3: [], error: err.message }, { status: 500 });
    }
}
