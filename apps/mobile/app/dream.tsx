import { Redirect } from "expo-router";

/** The chat is a page of the home ring now; old links land on it. */
export default function Dream() {
  return <Redirect href="/wishes?page=chat" />;
}
