import humanist, { IResult as IHumanistResult } from "humanist";

import { getDb, sqlInsert } from "../../db";
import Response from "../../Response";
import { IMessage, IMessageSource } from "../../types";
import alreadyTaken from "./already-taken";
import createIdentity from "./create-identity";
import modifyIdentity from "./modify-identity";

export { default as setup } from "./setup";

/*
  Supported commands
  
  A given sender can have multiple usernames associated with it, one of which will be in is_primary state.

  Account Management
  ------------------
  # Creates a new identity, owned by the sender's pkey
  # If the identity already exists, sets it as active.
  id jeswin 

  # Gives another user access to the identity
  id anongamers member jeswin

  # Gives another user admin access to the identity
  id anongamers admin jeswin

  # Disassociate a user from the identity
  # There needs to be at least one admit
  id anongamers remove jeswin

  # Sets custom domain for username
  id jeswin domain jeswin.org

  # Disables an identity
  id jeswin disable
  
  # Enables an identity
  id jeswin enable 

  # Deletes a previously disabled identity
  id jeswin destroy 
*/

const parser = humanist([
  ["id", 1],
  ["enable", 0],
  ["disable", 0],
  ["destroy", 0],
  ["domain", 1],
  ["admin", 1],
  ["member", 1],
  ["remove", 1]
]);

export async function handle(
  command: string,
  message: IMessage,
  msgSource: IMessageSource
): Promise<Response | undefined> {
  const lcaseCommand = command.toLowerCase();
  if (lcaseCommand.startsWith("id ")) {
    const args: any = parser(command);
    const identityName = args.id;
    const sender = message.sender;
    if (isValidIdentity(identityName)) {
      const identityStatus = await checkIdentityStatus(
        identityName,
        message.sender
      );
      return identityStatus.status === "AVAILABLE"
        ? await createIdentity(identityName, sender, command, message)
        : identityStatus.status === "TAKEN"
          ? await alreadyTaken(identityName, sender, command, message)
          : await modifyIdentity(identityStatus, args, command, message);
    }
  }
}

function isValidIdentity(username: string) {
  const regex = /^[a-z][a-z0-9_]+$/;
  return regex.test(username);
}

export interface IExistingIdentityResult {
  status: "ADMIN" | "MEMBER";
  enabled: boolean;
  identityName: string;
  membershipType: string;
  primaryIdentityName: string;
  sender: string;
}

export type IdentityStatusCheckResult =
  | IExistingIdentityResult
  | { status: "AVAILABLE" }
  | { status: "TAKEN" };

async function checkIdentityStatus(
  identityName: string,
  sender: string
): Promise<IdentityStatusCheckResult> {
  const db = await getDb();

  const identity = db
    .prepare(
      `SELECT
        i.enabled as enabled,
        i.name as identityName,
        ui.membership_type as membershipType,
        u.primary_identity_name as primaryIdentityName,
        u.sender as sender
      FROM user_identity ui
      JOIN identity i ON ui.identity_name = i.name
      JOIN user u on ui.user_pubkey = u.sender
      WHERE identity_name=$identityName`
    )
    .get({ identityName });

  if (!identity) {
    return { status: "AVAILABLE" };
  } else {
    if (identity.sender === sender) {
      return {
        enabled: identity.enabled,
        identityName: identity.identityName,
        membershipType: identity.membershipType,
        primaryIdentityName: identity.primaryIdentityName,
        sender,
        status: identity.membershipType === "ADMIN" ? "ADMIN" : "MEMBER"
      };
    } else {
      return {
        status: "TAKEN"
      };
    }
  }
}

export async function didNotUnderstand(command: string, message: IMessage) {
  return new Response(
    `Sorry I did not follow the instruction '${command}'. See https://scuttle.space/help.`,
    message.id
  );
}
