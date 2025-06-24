import type { OinPanelMessageTypes } from '../../message-types';
import type { privilegeString } from './index';

type type = '__MissingPrivilegesError__';

interface MissingPrivilegeErrorJson {
  __type__ : type,
  __messageType__: string,
  __data__: string[],
}

export default class MissingPrivilegesError extends Error {
  missingPrivileges: Array<privilegeString>;

  messageType: keyof OinPanelMessageTypes;

  constructor(messageType: keyof OinPanelMessageTypes, missingPrivileges: Array<privilegeString>) {
    super(`Your app is missing the privileges ${missingPrivileges.join(', ')} for action "${messageType}".`);

    this.missingPrivileges = missingPrivileges;

    this.messageType = messageType;

    // Set prototype explicitly
    Object.setPrototypeOf(this, MissingPrivilegesError.prototype);
  }

  toJSON(): MissingPrivilegeErrorJson {
    return {
      __type__: '__MissingPrivilegesError__',
      __messageType__: this.messageType,
      __data__: this.missingPrivileges,
    };
  }
}
