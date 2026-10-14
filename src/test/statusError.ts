// A refused SDK call as the real client throws it: the SDK's own error classes
// (a status-specific class for the statuses it names, `VectrosError` for the
// rest), built the way the client builds them from a parsed JSON body. Using the
// real classes anchors the `statusCode` and `body` field names the app reads.
import { Vectros, VectrosError } from '@vectros-ai/sdk';

export function statusError(statusCode: number, body: unknown): Error {
  switch (statusCode) {
    case 400:
      return new Vectros.BadRequestError(body);
    case 401:
      return new Vectros.UnauthorizedError(body);
    case 402:
      return new Vectros.PaymentRequiredError(body);
    case 403:
      return new Vectros.ForbiddenError(body);
    case 429:
      return new Vectros.TooManyRequestsError(body);
    default:
      return new VectrosError({ statusCode, body });
  }
}
