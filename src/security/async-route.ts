import {RequestHandler} from 'express';
/** Express 4 does not forward rejected handler promises automatically. */
export function asyncRoute(handler:RequestHandler):RequestHandler {
 return(req,res,next)=>{try{void Promise.resolve(handler(req,res,next)).catch(next);}catch(error){next(error);}};
}
