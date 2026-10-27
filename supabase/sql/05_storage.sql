-- ============================================================================
-- HooLiv Dues Manager — 05_storage.sql
-- Ticket attachments used to be stored as base64 inside the database. They now
-- live in a PRIVATE Supabase Storage bucket. The browser uploads image bytes to
-- this bucket; rpc_create_ticket_attachment records the object path; and the
-- attachment-list RPC + adapter hand back short-lived signed URLs for display.
-- ============================================================================

-- Create the private bucket (id == name). Idempotent.
insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Storage RLS policies (on storage.objects), scoped to this bucket.
-- Any signed-in user may read objects (they only ever receive a path/signed URL
-- for tickets they can already see, via the RPC layer). Uploads require the
-- ticket-management permission. Deletes are admin-only.
-- ---------------------------------------------------------------------------
drop policy if exists "ticket_attach_read"   on storage.objects;
drop policy if exists "ticket_attach_insert" on storage.objects;
drop policy if exists "ticket_attach_delete" on storage.objects;

create policy "ticket_attach_read"
  on storage.objects for select to authenticated
  using ( bucket_id = 'ticket-attachments' );

create policy "ticket_attach_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1 from public.profiles p
      where p.auth_id = auth.uid()
        and p.active = 1
        and (p.role = 'regional_head' or p.can_manage_tickets = 1)
    )
  );

create policy "ticket_attach_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1 from public.profiles p
      where p.auth_id = auth.uid() and p.role = 'regional_head'
    )
  );
