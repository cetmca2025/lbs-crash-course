import { adminFirestore } from "@/lib/firebase-admin";

export interface CachedRankings {
    quizAttempts: any[];
    mockAttempts: any[];
    users: Record<string, any>;
    quizzes: Record<string, any>;
    mockTests: Record<string, any>;
}

let cachedData: CachedRankings | null = null;
let cacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes cache
const MIN_REVALIDATE_INTERVAL = 60 * 1000; // 1 minute minimum between bypass revalidations

export async function getCachedRankingsData(bypassCache = false): Promise<CachedRankings> {
    if (!adminFirestore) {
        throw new Error("Database connection failed");
    }

    const now = Date.now();
    const canUseCache = cachedData && (!bypassCache || (now - cacheTime < MIN_REVALIDATE_INTERVAL));

    if (canUseCache && cachedData && (now - cacheTime < CACHE_TTL)) {
        return cachedData;
    }

    try {
        console.log("[RANKINGS_CACHE] Fetching fresh rankings data from Firestore...");
        const [quizzesSnap, mocksSnap, quizAttsSnap, mockAttsSnap] = await Promise.all([
            adminFirestore.collection("quizzes").orderBy("createdAt", "desc").get(),
            adminFirestore.collection("mockTests").orderBy("createdAt", "desc").get(),
            adminFirestore.collection("quizAttempts").orderBy("submittedAt", "desc").limit(2000).get(),
            adminFirestore.collection("mockAttempts").orderBy("submittedAt", "desc").limit(2000).get(),
        ]);

        const processTests = (snap: FirebaseFirestore.QuerySnapshot) => {
            const processed: Record<string, any> = {};
            snap.docs.forEach(doc => {
                const val = doc.data();
                processed[doc.id] = { 
                    id: doc.id, 
                    title: val.title, 
                    subject: val.subject,
                    status: val.status 
                };
            });
            return processed;
        };

        const quizzes = processTests(quizzesSnap);
        const mockTests = processTests(mocksSnap);

        const processAttempts = (snap: FirebaseFirestore.QuerySnapshot) => {
            return snap.docs.map(doc => {
                const val = doc.data();
                return {
                    id: doc.id,
                    userId: val.userId,
                    userName: val.userName,
                    score: Number(val.score) || 0,
                    totalQuestions: Number(val.totalQuestions) || 0,
                    submittedAt: Number(val.submittedAt) || 0,
                    quizId: val.quizId,
                    mockTestId: val.mockTestId
                };
            });
        };

        const MAX_ATTEMPTS = 5000;
        const quizAttempts = processAttempts(quizAttsSnap).slice(0, MAX_ATTEMPTS);
        const mockAttempts = processAttempts(mockAttsSnap).slice(0, MAX_ATTEMPTS);

        const users: Record<string, any> = {};
        const populateUsers = (attempts: any[]) => {
            attempts.forEach(a => {
                if (a.userId && !users[a.userId]) {
                    users[a.userId] = {
                        id: a.userId,
                        name: a.userName || "Student"
                    };
                }
            });
        };
        populateUsers(quizAttempts);
        populateUsers(mockAttempts);

        cachedData = {
            quizAttempts,
            mockAttempts,
            users,
            quizzes,
            mockTests
        };
        cacheTime = now;

        return cachedData;
    } catch (error: any) {
        console.error("[RANKINGS_CACHE] Error fetching fresh rankings:", error);
        // Fallback to cache if database fails
        if (cachedData) {
            console.log("[RANKINGS_CACHE] Returning stale cache due to fetch error.");
            return cachedData;
        }
        throw error;
    }
}
