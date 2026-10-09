import { people } from '../../people';
import { json } from '../respond';
import type { PublicHandler } from '../context';
export const listPeople: PublicHandler = () => json(people);
