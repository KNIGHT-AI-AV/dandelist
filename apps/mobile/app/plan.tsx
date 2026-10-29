import { Redirect } from "expo-router";

/** "The plan" became Details, a page of the home ring; old links land on it. */
export default function Plan() {
  return <Redirect href="/wishes?page=details" />;
}
