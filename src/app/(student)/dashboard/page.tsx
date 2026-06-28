"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { collection, getDocs, query, orderBy, limit, doc, getDoc, setDoc, updateDoc, increment } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { LiveClass, Announcement } from "@/lib/types";
import recordingsData from "@/data/recordings.json";
import {
    Video,
    MonitorPlay,
    BookOpen,
    FileText,
    Trophy,
    Megaphone,
    Clock,
    Calendar,
    ArrowRight,
    AlertCircle
} from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Add this component before the main DashboardPage
function LeaderboardSummary() {
    const { userData } = useAuth();
    const [top3, setTop3] = useState<{ rank: number; userId: string; userName: string; score: number; testsTaken: number }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const CACHE_KEY = "rankings_cache";
        const CACHE_TIME_KEY = "rankings_cache_time";
        const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

        const calculateTop3 = (data: any) => {
            const quizAttempts = data.quizAttempts || [];
            const allUsers = data.users || {};

            // Step 1: Deduplicate quiz attempts per (userId, quizId) — keep best score per user per quiz
            const bestPerUserQuiz = new Map<string, any>();
            quizAttempts.forEach((attempt: any) => {
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

            bestPerUserQuiz.forEach((attempt: any) => {
                const user = allUsers[attempt.userId];
                const userName = user?.name || attempt.userName || "Student";

                const existing = userMap.get(attempt.userId) || {
                    userId: attempt.userId,
                    userName: userName,
                    score: 0,
                    testsTaken: 0,
                    lastSubmission: 0
                };
                existing.score += (Number(attempt.score) || 0);
                existing.testsTaken += 1;
                existing.lastSubmission = Math.max(existing.lastSubmission, Number(attempt.submittedAt) || 0);
                userMap.set(attempt.userId, existing);
            });

            const sorted = Array.from(userMap.values())
                .sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    return a.lastSubmission - b.lastSubmission;
                })
                .slice(0, 3)
                .map((e, i) => ({ ...e, rank: i + 1 }));

            setTop3(sorted);
        };

        const fetchRankings = async () => {
            try {
                // Check cache first
                const cached = sessionStorage.getItem(CACHE_KEY);
                const cachedTime = sessionStorage.getItem(CACHE_TIME_KEY);
                if (cached && cachedTime && (Date.now() - Number(cachedTime)) < CACHE_TTL) {
                    calculateTop3(JSON.parse(cached));
                    setLoading(false);
                    return;
                }

                const res = await fetch("/api/rankings");
                if (!res.ok) throw new Error("Failed to fetch");
                const data = await res.json();

                sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
                sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());

                calculateTop3(data);
            } catch (err) {
                console.error("[DASHBOARD_LEADERBOARD] Error loading leaderboard summary:", err);
                setTop3([]);
            } finally {
                setLoading(false);
            }
        };

        fetchRankings();
    }, []);

    const medals = ["🥇", "🥈", "🥉"];

    return (
        <Card className="flex flex-col border border-border bg-card">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-yellow-500" />
                    Top Performers
                </CardTitle>
                <Link href="/dashboard/rankings" className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                    View all <ArrowRight className="h-3 w-3" />
                </Link>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-center">
                {loading ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center gap-3">
                                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                                <Skeleton className="h-4 flex-1" />
                                <Skeleton className="h-4 w-14" />
                            </div>
                        ))}
                    </div>
                ) : top3.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                        <Trophy className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        No rankings yet
                    </div>
                ) : (
                    <div className="space-y-2">
                        {top3.map((entry, i) => {
                            const isMe = entry.userId === userData?.uid;
                            return (
                                <div
                                    key={entry.userId}
                                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${isMe ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/40"}`}
                                >
                                    <span className="text-lg w-6 text-center shrink-0">{medals[i]}</span>
                                    <span className={`text-sm flex-1 truncate ${isMe ? "font-semibold text-primary" : "font-medium"}`}>
                                        {isMe ? "You" : entry.userName}
                                    </span>
                                    <span className="text-xs font-mono text-muted-foreground shrink-0">{entry.score} pts</span>
                                </div>
                            );
                        })}
                        {!top3.some((e) => e.userId === userData?.uid) && (
                            <p className="text-center text-[11px] text-muted-foreground pt-2">
                                Take a quiz to appear on the leaderboard!
                            </p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function ExamPoll() {
    const { user } = useAuth();
    const [votedOption, setVotedOption] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [pollResults, setPollResults] = useState<{ easy: number; medium: number; hard: number }>({ easy: 0, medium: 0, hard: 0 });
    const [totalVotes, setTotalVotes] = useState(0);

    const loadPollData = async () => {
        try {
            // Load user's vote locally
            const localVote = localStorage.getItem("lbs_exam_poll_vote");
            setVotedOption(localVote);

            // Load aggregate votes from a single document
            const docRef = doc(firestore, "polls", "lbsExam");
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                const results = {
                    easy: Math.max(0, Number(data.easy) || 0),
                    medium: Math.max(0, Number(data.medium) || 0),
                    hard: Math.max(0, Number(data.hard) || 0)
                };
                setPollResults(results);
                setTotalVotes(results.easy + results.medium + results.hard);
            } else {
                setPollResults({ easy: 0, medium: 0, hard: 0 });
                setTotalVotes(0);
            }
        } catch (err) {
            console.error("Error loading poll data:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPollData();
    }, [user?.uid]);

    const handleVote = async (option: "easy" | "medium" | "hard") => {
        if (submitting) return;
        
        const oldOption = localStorage.getItem("lbs_exam_poll_vote") as "easy" | "medium" | "hard" | null;
        if (oldOption === option) return;

        setSubmitting(true);
        try {
            const docRef = doc(firestore, "polls", "lbsExam");
            
            // Check if document exists, if not initialize it
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) {
                await setDoc(docRef, { easy: 0, medium: 0, hard: 0 });
            }

            const updates: Record<string, any> = {};
            if (oldOption) {
                updates[oldOption] = increment(-1);
            }
            updates[option] = increment(1);

            await updateDoc(docRef, updates);

            localStorage.setItem("lbs_exam_poll_vote", option);
            setVotedOption(option);
            
            // Refresh results
            await loadPollData();
        } catch (err) {
            console.error("Error submitting vote:", err);
        } finally {
            setSubmitting(false);
        }
    };

    const getPercentage = (count: number) => {
        if (totalVotes === 0) return 0;
        return Math.round((count / totalVotes) * 100);
    };

    if (loading) {
        return (
            <Card className="border border-border bg-card">
                <CardContent className="p-6 space-y-4">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </CardContent>
            </Card>
        );
    }

    const options = [
        { id: "easy", label: "Easy", desc: "score 90 above", color: "bg-emerald-500", hoverColor: "hover:border-emerald-500/30 hover:bg-emerald-500/5", activeBorder: "border-emerald-500" },
        { id: "medium", label: "Medium", desc: "score 65-89", color: "bg-amber-500", hoverColor: "hover:border-amber-500/30 hover:bg-amber-500/5", activeBorder: "border-amber-500" },
        { id: "hard", label: "Hard", desc: "below 60", color: "bg-rose-500", hoverColor: "hover:border-rose-500/30 hover:bg-rose-500/5", activeBorder: "border-rose-500" }
    ] as const;

    return (
        <Card className="border border-border bg-card shadow-sm overflow-hidden relative animate-fade-in">
            <div className="absolute top-0 left-0 w-32 h-32 bg-linear-to-br from-primary/5 via-transparent to-transparent rounded-full blur-xl pointer-events-none" />
            <CardHeader className="pb-3 relative">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2 font-bold">
                    <span className="text-xl">📊</span> How was the LBS MCA Entrance Exam?
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                    {!votedOption 
                        ? "Cast your vote to see what other aspirants think about the exam difficulty." 
                        : "You've voted! Tap any other option to change your vote."}
                </p>
            </CardHeader>
            <CardContent className="space-y-3 relative">
                {options.map((opt) => {
                    const count = pollResults[opt.id];
                    const pct = getPercentage(count);
                    const isSelected = votedOption === opt.id;
                    
                    return (
                        <button
                            key={opt.id}
                            disabled={submitting}
                            onClick={() => handleVote(opt.id)}
                            className={`w-full relative p-4 rounded-xl border transition-all overflow-hidden text-left group ${
                                isSelected 
                                    ? `${opt.activeBorder} bg-primary/5 shadow-sm` 
                                    : "border-border bg-card/30 hover:border-primary/20 hover:bg-card/50"
                            } hover:scale-[1.01] active:scale-[0.99]`}
                        >
                            {/* Progress Bar background */}
                            {votedOption && (
                                <div
                                    className={`absolute top-0 left-0 h-full opacity-[0.08] ${opt.color} transition-all duration-200`}
                                    style={{ width: `${pct}%` }}
                                />
                            )}
                            
                            <div className="relative flex justify-between items-center text-sm font-medium z-10">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-foreground group-hover:text-primary transition-colors">{opt.label}</span>
                                    <span className="text-xs text-muted-foreground">({opt.desc})</span>
                                    {isSelected && (
                                        <Badge variant="outline" className="text-[10px] font-semibold bg-primary/10 text-primary border-primary/20 leading-none py-0.5 px-1.5 ml-2">
                                            Your Vote
                                        </Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    {votedOption ? (
                                        <>
                                            <span className="text-xs text-muted-foreground">{count} {count === 1 ? "vote" : "votes"}</span>
                                            <span className="font-bold font-mono text-foreground">{pct}%</span>
                                        </>
                                    ) : (
                                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform group-hover:text-primary" />
                                    )}
                                </div>
                            </div>
                            
                            {/* Visual representation bar */}
                            {votedOption && (
                                <div className="relative mt-2 w-full h-1.5 rounded-full bg-muted/30 overflow-hidden z-10">
                                    <div className={`h-full rounded-full ${opt.color} transition-all duration-200`} style={{ width: `${pct}%` }} />
                                </div>
                            )}
                        </button>
                    );
                })}
                
                {votedOption && (
                    <div className="pt-2 text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1.5">
                        <span>Total votes: <strong>{totalVotes}</strong></span>
                        <span>•</span>
                        <button 
                            onClick={loadPollData}
                            className="hover:underline text-primary font-medium"
                        >
                            Refresh Results
                        </button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}


export default function StudentDashboard() {
    const { userData } = useAuth();
    const [upcomingClasses, setUpcomingClasses] = useState<LiveClass[]>([]);
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [recorded, setRecorded] = useState<Array<{ id: string; subject: string; title: string }>>([]);
    const [progressMap, setProgressMap] = useState<Record<string, { completed?: boolean; timestamp?: number; duration?: number; updatedAt?: number }>>({});

    useEffect(() => {
        const DASHBOARD_CACHE_KEY = "dashboard_data_cache";
        const DASHBOARD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

        const fetchDashboardData = async () => {
            // Issue 5 fix: Check sessionStorage cache first
            try {
                const cached = sessionStorage.getItem(DASHBOARD_CACHE_KEY);
                if (cached) {
                    const { classes, anns, timestamp } = JSON.parse(cached);
                    if (Date.now() - timestamp < DASHBOARD_CACHE_TTL) {
                        setUpcomingClasses(classes);
                        setAnnouncements(anns);
                        return;
                    }
                }
            } catch { /* ignore cache errors */ }

            try {
                const [liveSnap, annSnap] = await Promise.all([
                    getDocs(query(collection(firestore, "liveClasses"), orderBy("scheduledAt", "desc"), limit(3))),
                    getDocs(query(collection(firestore, "announcements"), orderBy("createdAt", "desc"), limit(3))),
                ]);

                const classes: LiveClass[] = [];
                liveSnap.docs.forEach((d) => {
                    const data = d.data();
                    if (data.status !== "completed") {
                        classes.push({ ...data, id: d.id } as LiveClass);
                    }
                });
                setUpcomingClasses(classes);

                const anns: Announcement[] = annSnap.docs.map((d) => ({
                    ...d.data(), id: d.id,
                } as Announcement));
                setAnnouncements(anns);

                // Save to cache
                try {
                    sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
                        classes,
                        anns,
                        timestamp: Date.now()
                    }));
                } catch { /* ignore */ }
            } catch (err) {
                console.error("Failed to fetch dashboard data:", err);
            }
        };
        fetchDashboardData();
    }, []);

    useEffect(() => {
        // Static data — no Firestore reads needed for recorded classes
        const list: Array<{ id: string; subject: string; title: string }> = (recordingsData as Array<{ id: string; subject: string; title: string }>).map((v) => ({
            id: v.id,
            subject: v.subject || "General",
            title: v.title || "",
        }));
        setRecorded(list);

        if (userData?.uid) {
            const key = `video_progress_${userData.uid}`;
            
            const loadProgressMap = () => {
                try {
                    const raw = localStorage.getItem(key);
                    if (raw) setProgressMap(JSON.parse(raw));
                } catch { /* ignore */ }
            };
            
            loadProgressMap();
            
            const handleCustomUpdate = () => loadProgressMap();
            const handleStorageUpdate = (e: StorageEvent) => {
                if (e.key === key) loadProgressMap();
            };

            window.addEventListener("video_progress_updated", handleCustomUpdate);
            window.addEventListener("storage", handleStorageUpdate);

            return () => {
                window.removeEventListener("video_progress_updated", handleCustomUpdate);
                window.removeEventListener("storage", handleStorageUpdate);
            };
        }
        return () => {};
    }, [userData?.uid]);

    const progressBySubject = useMemo(() => {
        const totals: Record<string, { total: number; done: number }> = {};
        for (const rc of recorded) {
            const subj = rc.subject || "General";
            if (!totals[subj]) totals[subj] = { total: 0, done: 0 };
            totals[subj].total += 1;
            if (progressMap[rc.id]?.completed) totals[subj].done += 1;
        }
        return totals;
    }, [recorded, progressMap]);

    const overallPct = useMemo(() => {
        let total = 0, done = 0;
        for (const rc of recorded) {
            total += 1;
            if (progressMap[rc.id]?.completed) done += 1;
        }
        return total > 0 ? Math.round((done / total) * 100) : 0;
    }, [recorded, progressMap]);

    const resumeTarget = useMemo(() => {
        let latest: { id: string; updatedAt: number } | null = null;
        Object.entries(progressMap).forEach(([id, v]) => {
            if (v.completed) return;
            const ua = v.updatedAt || 0;
            if (!latest || ua > latest.updatedAt) latest = { id, updatedAt: ua };
        });
        if (!latest) return null;
        const meta = recorded.find(r => r.id === latest!.id);
        return meta ? { id: meta.id, title: meta.title } : null;
    }, [progressMap, recorded]);

    const quickActions = [
        { label: "Live Classes", description: "Join live sessions", href: "/dashboard/live-classes", icon: Video, color: "from-blue-500 to-cyan-500", show: userData?.is_live },
        { label: "Recorded Classes", description: "Watch at your pace", href: "/dashboard/recorded-classes", icon: BookOpen, color: "from-violet-500 to-purple-500", show: userData?.is_record_class },
        { label: "Quizzes", description: "Test your knowledge", href: "/dashboard/quizzes", icon: FileText, color: "from-pink-500 to-rose-500", show: true },
        { label: "Mock Tests", description: "Full-length practice", href: "/dashboard/mock-tests", icon: BookOpen, color: "from-amber-500 to-orange-500", show: true },
        { label: "Leaderboard & Rankings", description: "See your standing", href: "/dashboard/rankings", icon: Trophy, color: "from-teal-500 to-emerald-500", show: true },
        { label: "Announcements", description: "Latest updates", href: "/dashboard/announcements", icon: Megaphone, color: "from-green-500 to-lime-500", show: true },
    ];
    const quickActionsWithResume = resumeTarget
        ? [{ label: "Resume Video", description: "Continue where you left off", href: `/dashboard/recorded-classes?videoId=${resumeTarget.id}`, icon: MonitorPlay, color: "from-violet-500 to-purple-500", show: true }, ...quickActions]
        : quickActions;

    return (
        <div className="animate-fade-in space-y-6">
            {/* Top Row: Welcome & Leaderboard */}
            <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-linear-to-bl from-primary/10 via-transparent to-transparent rounded-full blur-2xl" />
                        <div className="relative">
                            <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">
                                All the Best for Your <span className="gradient-text">LBS MCA Entrance Exam.</span>
                            </h1>
                            
                            <div className="mt-4 space-y-4 text-sm sm:text-base text-muted-foreground">
                                <p className="font-medium text-foreground/90">
                                    Today is your opportunity to turn months of hard work into success. Stay calm, trust your preparation, and give your best in every question.
                                </p>

                                <div className="p-4 rounded-xl border border-amber-500/25 bg-amber-500/5 text-amber-600 dark:text-amber-400 text-xs sm:text-sm">
                                    <span className="font-bold">💡 Remember:</span> There is <span className="font-bold underline decoration-amber-500/40">no negative marking</span>, so don't leave any question unanswered. If you're unsure about an answer, make your best educated guess—every question is an opportunity to score.
                                </div>
                                
                                <div className="pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground">
                                    <span className="font-bold text-primary bg-primary/10 border border-primary/20 rounded-md px-2 py-0.5">by CETMCA-27</span>
                                </div>
                            </div>
                          
                        </div>
                    </div>

                    <ExamPoll />
                </div>
                <LeaderboardSummary />
            </div>

            {/* Quick Actions */}
            <div>
                <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {quickActionsWithResume
                        .filter((a) => a.show)
                        .map((action) => (
                            <Link key={action.href} href={action.href}>
                                <Card className="hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer group h-full">
                                    <CardContent className="p-4 text-center">
                                        <div
                                            className={`mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-linear-to-br ${action.color} transition-transform duration-300 group-hover:scale-110`}
                                        >
                                            <action.icon className="h-5 w-5 text-white" />
                                        </div>
                                        <p className="text-sm font-medium">{action.label}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5 hidden sm:block">{action.description}</p>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Upcoming Live Classes */}
                {userData?.is_live && (
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Video className="h-4 w-4 text-blue-500" />
                                Upcoming Classes
                            </CardTitle>
                            <Link href="/dashboard/live-classes">
                                <Button variant="ghost" size="sm" className="text-xs">
                                    View All <ArrowRight className="h-3 w-3 ml-1" />
                                </Button>
                            </Link>
                        </CardHeader>
                        <CardContent>
                            {upcomingClasses.length === 0 ? (
                                <div className="text-center py-8">
                                    <Video className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                                    <p className="text-sm text-muted-foreground italic">No upcoming sessions today</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {upcomingClasses.map((cls) => (
                                        <div
                                            key={cls.id}
                                            className="flex items-center justify-between rounded-xl border border-border p-3.5 transition-colors hover:bg-muted/30"
                                        >
                                            <div className="space-y-1 min-w-0 flex-1">
                                                <p className="text-sm font-medium truncate">{cls.title}</p>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" />
                                                        {format(new Date(cls.scheduledAt), "MMM d")}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {format(new Date(cls.scheduledAt), "h:mm a")}
                                                    </span>
                                                </div>
                                            </div>
                                            <Badge variant={cls.status === "live" ? "live" : "secondary"} className="ml-2 shrink-0">
                                                {cls.status === "live" ? "● LIVE" : cls.status}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Recorded Progress */}
                {userData?.is_record_class && (
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <MonitorPlay className="h-4 w-4 text-violet-500" />
                                Recorded Progress
                            </CardTitle>
                            <span className="text-xs text-muted-foreground">Overall {overallPct}%</span>
                        </CardHeader>
                        <CardContent>
                            {Object.keys(progressBySubject).length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    <AlertCircle className="h-6 w-6 mx-auto mb-1" />
                                    No recorded classes yet
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {Object.entries(progressBySubject).map(([subj, v]) => {
                                        const pct = v.total > 0 ? Math.round((v.done / v.total) * 100) : 0;
                                        return (
                                            <div key={subj} className="flex items-center gap-3">
                                                <div className="w-40 text-sm font-medium truncate">{subj}</div>
                                                <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
                                                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                                                </div>
                                                <div className="w-28 text-right text-xs text-muted-foreground">{v.done}/{v.total} • {pct}%</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Recent Announcements */}
                <Card className={!userData?.is_live ? "lg:col-span-2" : ""}>
                    <CardHeader className="flex flex-row items-center justify-between pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Megaphone className="h-4 w-4 text-green-500" />
                            Recent Announcements
                        </CardTitle>
                        <Link href="/dashboard/announcements">
                            <Button variant="ghost" size="sm" className="text-xs">
                                View All <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        {announcements.length === 0 ? (
                            <div className="text-center py-8">
                                <Megaphone className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                                <p className="text-sm text-muted-foreground">No announcements yet</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {announcements.map((ann) => (
                                    <div key={ann.id} className="rounded-xl border border-border p-3.5 hover:bg-muted/30 transition-colors">
                                        <p className="text-sm font-medium">{ann.title}</p>
                                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{ann.content}</p>
                                        <p className="mt-2 text-[10px] text-muted-foreground">
                                            {format(new Date(ann.createdAt), "MMM d, yyyy · h:mm a")}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
