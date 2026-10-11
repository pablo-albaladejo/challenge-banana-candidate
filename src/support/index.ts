// Public surface of the support feature: other features import only from here.
export { support, type SupportApp } from './entry-points/dependencies';
export { requestHumanTool } from './entry-points/tools/request-human.tool';
export { incidentDetail, listIncidents } from './entry-points/http/incidents';
