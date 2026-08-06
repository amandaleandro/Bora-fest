"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

/** Some na carteira só depois que o evento termina — pede pra quem tem sessão avaliar. */
export function EventReview({ eventId, endsAt }: { eventId: string; endsAt: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("bf.token");
    setToken(stored);
    if (!stored) return;
    api
      .getMyReview(eventId, stored)
      .then((review) => {
        if (review) {
          setRating(review.rating);
          setComment(review.comment ?? "");
          setSubmitted(true);
        }
      })
      .catch(() => {});
  }, [eventId]);

  if (!token || new Date(endsAt).getTime() > Date.now()) return null;

  async function submit() {
    if (!token || rating === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.submitReview(eventId, { rating, comment: comment.trim() || undefined }, token);
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar sua avaliação");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-[15px] font-extrabold">{submitted ? "Sua avaliação" : "Como foi o evento?"}</h2>
      <div className="mt-3 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={submitted}
            onClick={() => setRating(n)}
            className={`text-[26px] leading-none ${n <= rating ? "text-warning" : "text-line"}`}
            aria-label={`${n} estrelas`}
          >
            ★
          </button>
        ))}
      </div>
      {!submitted && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comentário (opcional)"
            rows={2}
            className="mt-3 w-full rounded-xl border border-line-input bg-bg p-3 text-[13px] outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={submit}
            disabled={rating === 0 || saving}
            className="mt-3 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {saving ? "Enviando…" : "Enviar avaliação"}
          </button>
          {error && <p className="mt-2 text-[12px] font-bold text-danger">{error}</p>}
        </>
      )}
      {submitted && <p className="mt-2 text-[12px] font-semibold text-muted">Obrigado pelo feedback!</p>}
    </section>
  );
}
