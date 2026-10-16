import { screenSchema, type WireScreen } from '../shared/schema.js';
import { z } from 'zod';
import { synchronizeNavigation } from '../shared/wireframe-navigation.js';
import { AppError } from './errors.js';
import { uid, guardWireTrees } from './documents.js';

export function syncNavigation(previous:WireScreen[],next:WireScreen[]):WireScreen[]{
  guardWireTrees(next);
  const parsed=z.array(screenSchema).max(100).parse(next);
  try{return synchronizeNavigation(previous,parsed,uid);}
  catch(error){throw new AppError(400,'INVALID_NAVIGATION',error instanceof Error?error.message:'공통 내비게이션 연결을 확인해 주세요.');}
}
