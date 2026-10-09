import { HttpError } from '../../auth';
import { ingest } from '../../ingestion/pipeline';
import { json } from '../respond';
import type { Handler } from '../context';
export const runIngestion: Handler = async ({ actor }) => {
  if (actor.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  return json(await ingest());
};
