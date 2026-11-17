/** "Research Stories" for `research_stories`, as the admin shows a job: the server keeps no display names of its own. */
export const jobDisplayName = (jobName: string): string =>
  jobName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
