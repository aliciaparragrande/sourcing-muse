
DROP POLICY IF EXISTS "Authenticated can update briefs" ON public.briefs;
CREATE POLICY "Authenticated can update briefs"
  ON public.briefs FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
