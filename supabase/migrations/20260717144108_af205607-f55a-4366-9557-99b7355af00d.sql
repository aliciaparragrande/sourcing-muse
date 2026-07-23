
-- Collaborative editing: any authenticated recruiter can view + edit any brief.
DROP POLICY IF EXISTS "Owners and admins can view briefs" ON public.briefs;
DROP POLICY IF EXISTS "Owners can update own briefs" ON public.briefs;

CREATE POLICY "Authenticated can view briefs"
  ON public.briefs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can update briefs"
  ON public.briefs FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- Optional assigned owner (defaults to creator).
ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.briefs SET assigned_to = owner_id WHERE assigned_to IS NULL;

CREATE OR REPLACE FUNCTION public.briefs_set_default_assignee()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    NEW.assigned_to := NEW.owner_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS briefs_default_assignee ON public.briefs;
CREATE TRIGGER briefs_default_assignee
  BEFORE INSERT ON public.briefs
  FOR EACH ROW EXECUTE FUNCTION public.briefs_set_default_assignee();

-- Recruiters need to see each other's names to pick an assignee and see attributions.
DROP POLICY IF EXISTS "Users can view own profile or admins view all" ON public.profiles;
CREATE POLICY "Authenticated can view profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (true);
