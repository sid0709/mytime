import changelogMarkdown from "../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";

export const changelogReleases = parseChangelog(changelogMarkdown);
