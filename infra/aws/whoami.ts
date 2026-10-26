import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { credentials, region } from "./creds";

const id = await new STSClient({ region, credentials }).send(new GetCallerIdentityCommand({}));
console.log({ account: id.Account, arn: id.Arn });
