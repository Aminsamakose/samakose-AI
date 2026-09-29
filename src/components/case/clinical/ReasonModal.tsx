'use client';
import { useState } from 'react';
import { ApiFail } from '@/lib/client/api';
import { Button, Field, FormError, Modal, useForm } from '@/components/ui';

/** A button that opens a dialog asking for a mandatory reason, then calls `submit(reason)`. */
export default function ReasonModal({ label, title, prompt, fieldLabel = 'Reason', minLength = 5, submit, onDone, success }: {
  label: string; title?: string; prompt?: string; fieldLabel?: string; minLength?: number; success?: string;
  submit: (reason: string) => Promise<unknown>; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const f = useForm({ reason: '' }, async (v) => {
    if (v.reason.trim().length < minLength) throw new ApiFail(400, 'validation_failed', 'Please add a reason', { reason: `Write at least ${minLength} characters` });
    return submit(v.reason.trim());
  }, { success, onDone: () => { setOpen(false); f.setValues({ reason: '' }); onDone(); } });
  return <>
    <Button size="sm" onClick={() => setOpen(true)}>{label}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title={title ?? label}>
      <form onSubmit={f.onSubmit} className="stack" noValidate>
        {prompt && <p className="muted">{prompt}</p>}
        <FormError message={f.formError && !f.errors.reason ? f.formError : null} />
        <Field label={fieldLabel} name="reason" required error={f.errors.reason}>{(p) => <textarea {...p} rows={3} {...f.input('reason')} />}</Field>
        <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{label}</Button><Button type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
      </form>
    </Modal>
  </>;
}
