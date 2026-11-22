import type { Request, Response } from 'express';

export interface GraphQLRequestContext {
  req: Request;
  res: Response;
}
