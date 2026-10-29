import { Redirect } from "expo-router";

/** /terms still works: it opens the combined page at the terms. */
export default function Terms() {
  return <Redirect href={{ pathname: "/legal", params: { section: "terms" } }} />;
}
