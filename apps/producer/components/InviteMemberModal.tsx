"use client";

import { useState } from "react";
import { Modal, ghostBtn, modalInput, modalLabel, solidBtn } from "@/components/Modal";
import { MEMBER_ROLES, organizationsApi, type MemberRoleKey } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function InviteMemberModal({ organizationId, onClose }: { organizationId: string; onClose: () => void }) {
  const { token } = useAuth();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<MemberRoleKey>("admin");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await organizationsApi.inviteMember(token, organizationId, email, roleKey);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o convite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Convidar para a equipe"
      subtitle="A pessoa recebe um convite por e-mail e acessa só o que o papel permite."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostBtn}>
            Fechar
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy || sent || !email.includes("@")}
            className={solidBtn}
          >
            {sent ? "Convite enviado" : busy ? "Enviando…" : "Enviar convite"}
          </button>
        </>
      }
    >
      <label className={modalLabel} htmlFor="invite-email">
        E-mail
      </label>
      <input
        id="invite-email"
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setSent(false);
        }}
        placeholder="pessoa@suaprodutora.com"
        className={modalInput}
      />

      <p className={`${modalLabel} mt-3.5`}>Papel</p>
      <div className="flex flex-col gap-2">
        {MEMBER_ROLES.map((role) => {
          const active = roleKey === role.key;
          return (
            <button
              key={role.key}
              type="button"
              onClick={() => setRoleKey(role.key)}
              aria-pressed={active}
              className={`flex items-center gap-3 rounded-[13px] border-[1.5px] px-4 py-3 text-left ${
                active ? "border-primary bg-primary/5" : "border-line-input"
              }`}
            >
              <span className="flex-1">
                <span className="block text-[13px] font-extrabold text-ink">{role.label}</span>
                <span className="mt-1 block text-[11px] font-medium leading-snug text-muted">{role.description}</span>
              </span>
              <span
                className={`h-[18px] w-[18px] shrink-0 rounded-full border-[5px] ${
                  active ? "border-primary bg-surface" : "border-line-input bg-surface"
                }`}
              />
            </button>
          );
        })}
      </div>

      {sent ? (
        <p className="mt-4 rounded-xl border border-success/20 bg-success/5 px-3.5 py-3 text-[12.5px] font-semibold text-[#166534]">
          Convite enviado para <b>{email}</b> — expira em 7 dias.
        </p>
      ) : (
        <p className="mt-4 text-[12px] font-medium text-muted-2">O convite expira em 7 dias.</p>
      )}
      {error ? <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p> : null}
    </Modal>
  );
}
