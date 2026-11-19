-- Annual review questions transcribed from the current review form (sections B.1, C, C.1, D).
-- Run by hand in the SQL Editor after 01. Re-runnable: a question whose prompt is already in the
-- active annual template is skipped, so nothing is duplicated. New questions are appended after
-- the template's existing last position.
--
-- rev_questions has no section column, so the section name goes in help_text.
-- Section D wording is the staff member's (self-review) side of the "Is this role a good fit for
-- this person? / How satisfied are you with your current role?" pairs.

do $$
declare
  v_template uuid;
  v_pos      int;
begin
  select id into v_template from rev_templates where kind = 'annual' and is_active;
  if v_template is null then
    raise exception 'No active annual template: create one first (rev_templates, kind = annual, is_active).';
  end if;

  select coalesce(max(position), 0) into v_pos from rev_questions where template_id = v_template;

  insert into rev_questions (template_id, position, prompt, help_text, type, options, required, worker_types)
  select v_template, v_pos + row_number() over (order by q.ord), q.prompt, q.help_text, q.type, q.options, q.required, q.worker_types
  from (values
    -- B.1 - Review
    (1,  'List what you consider to be the most significant accomplishments in your job in the last 12 months.',
         'B.1 - Review', 'paragraph', null::jsonb, true, array['paid','seconded','volunteer']),
    (2,  'What aspects of your work do you find encouraging? What aspects of your work do you find challenging?',
         'B.1 - Review', 'paragraph', null::jsonb, true, array['paid','seconded','volunteer']),
    (3,  'Is there anything that you have worked on this year which has deflected you from your planned goals? If yes, explain.',
         'B.1 - Review', 'paragraph', null::jsonb, true, array['paid','seconded','volunteer']),
    (4,  '(Optional) Are there issues you believe are affecting your work performance? (spiritual, physical, financial, family health)',
         'B.1 - Review. Note that this question and answer will not be included in the review sent to HR.',
         'paragraph', null::jsonb, false, array['paid','seconded','volunteer']),

    -- C - Looking Ahead
    (5,  'How are you using your strengths in your role? How would you like to develop these in the next year?',
         'C - Looking Ahead', 'paragraph', null::jsonb, true, array['paid','seconded','volunteer']),
    (6,  'Do you anticipate any changes for you in the next year? In the more distant future?',
         'C - Looking Ahead', 'paragraph', null::jsonb, true, array['paid','seconded','volunteer']),
    (7,  'As you look ahead over the next three years, how do you see your job responsibilities changing? How do you feel',
         'C - Looking Ahead', 'paragraph', null::jsonb, true, array['paid','seconded','volunteer']),  -- TODO: prompt is cut off in the screenshot; complete the wording

    -- C.1 - PD - Supported Staff (support-raising: not asked of paid staff; adjust worker_types if needed)
    (8,  'What has your average support level been during the past 12 months?',
         'C.1 - PD - Supported Staff', 'short_text', null::jsonb, true, array['seconded','volunteer']),
    (9,  'If your support is currently below 95% of your established ministry budget, what plans do you have to bring it up to 100%?',
         'C.1 - PD - Supported Staff', 'paragraph', null::jsonb, false, array['seconded','volunteer']),
    (10, 'How often do you send newsletters to your donors? How many have you sent in the past 12 months?',
         'C.1 - PD - Supported Staff', 'paragraph', null::jsonb, true, array['seconded','volunteer']),

    -- D - Job Satisfaction (two-star = positive, one-star = needs change)
    (11, 'How satisfied are you with your current role?',
         'D - Job Satisfaction', 'select',
         '["★★ Good Fit / Satisfied", "★ Position needs Review / Not happy with current role and would like some change."]'::jsonb,
         true, array['paid','seconded','volunteer']),
    (12, 'How satisfied are you with your job performance?',
         'D - Job Satisfaction', 'select',
         '["★★ Performing Effectively / Satisfied", "★ Performance needs adjustment / Not happy with current performance and would like some change"]'::jsonb,
         true, array['paid','seconded','volunteer'])
  ) as q(ord, prompt, help_text, type, options, required, worker_types)
  where not exists (
    select 1 from rev_questions e where e.template_id = v_template and e.prompt = q.prompt
  );
end $$;
