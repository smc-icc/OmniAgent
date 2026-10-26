import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: false,
});

export function parseWeChatXml<T = Record<string, unknown>>(xml: string): T {
  const parsed = parser.parse(xml) as { xml?: T };
  return (parsed.xml ?? parsed) as T;
}

export function buildWeChatXml(obj: Record<string, unknown>): string {
  return builder.build({ xml: obj });
}

export function buildTextReplyXml(
  toUser: string,
  fromUser: string,
  content: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return buildWeChatXml({
    ToUserName: toUser,
    FromUserName: fromUser,
    CreateTime: timestamp,
    MsgType: 'text',
    Content: content,
  });
}
