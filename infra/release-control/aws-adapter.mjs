import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const need = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value) => typeof value === "string" && value.length > 0;
const isSha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isDigest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const canonical = (value) => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])) : value;
const serialized = (value) => JSON.stringify(canonical(value));
const bytesHash = (value) => createHash("sha256").update(value).digest("hex");
const hash = (value) => bytesHash(serialized(value));
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
const frozen = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
};
const buildStatus = (status) => {
  if (["IN_PROGRESS", "SUCCEEDED"].includes(status)) return status;
  need(["FAILED", "FAULT", "STOPPED", "TIMED_OUT"].includes(status), "Unknown build status; reconcile without mutation");
  return "FAILED";
};
const operationStatus = (status) => {
  if (status === "SUCCEEDED") return status;
  if (["PENDING", "IN_PROGRESS", "ROLLBACK_IN_PROGRESS"].includes(status)) return "IN_PROGRESS";
  need(["FAILED", "ROLLBACK_FAILED", "ROLLBACK_SUCCEEDED"].includes(status), "Unknown operation status; reconcile without mutation");
  return "FAILED";
};
class UnresolvedSource extends Error {
  constructor(id, providerStatus) {
    super("Recorded build lacks resolved source proof");
    this.result = buildStatus(providerStatus) === "FAILED"
      ? { id, status: "FAILED", sourceUnverified: true, providerStatus }
      : { id, status: "IN_PROGRESS", sourcePending: true, providerStatus };
  }
}

const specKeys = ["account", "region", "project", "repository", "serviceArn", "sourceUrl", "buildspec", "blobs", "port", "computeType", "timeoutMinutes"];
const projectFields = ["source", "secondarySources", "sourceVersion", "secondarySourceVersions", "artifacts", "secondaryArtifacts", "environment", "serviceRole", "cache", "timeoutInMinutes", "queuedTimeoutInMinutes", "encryptionKey", "vpcConfig", "logsConfig", "fileSystemLocations", "concurrentBuildLimit", "autoRetryLimit"];
const repositoryFields = ["repositoryArn", "registryId", "repositoryUri", "imageTagMutability", "imageTagMutabilityExclusionFilters", "imageScanningConfiguration", "encryptionConfiguration"];
const serviceFields = ["InstanceConfiguration", "HealthCheckConfiguration", "NetworkConfiguration", "AutoScalingConfigurationSummary", "ObservabilityConfiguration", "EncryptionConfiguration"];

/** Provider calls are injected. This module never imports credentials, SDKs or a provisioning helper. */
export class AwsReleaseAdapter {
  #control; #provider; #verifySource; #spec; #clock; #root;

  constructor({ control, provider, verifySource, spec, clock }) {
    need(control && text(control.root) && typeof provider?.call === "function" && typeof verifySource === "function", "Control, provider and source verifier required");
    need(spec && Object.keys(spec).every((key) => specKeys.includes(key)), "Unknown release specification field");
    const selected = structuredClone({ port: "8080", computeType: "BUILD_GENERAL1_SMALL", timeoutMinutes: 20, ...spec });
    need(typeof selected.account === "string" && /^\d{12}$/.test(selected.account) && typeof selected.region === "string" && /^[a-z]{2}-[a-z]+-\d$/.test(selected.region), "Exact account and region required");
    need([selected.project, selected.repository].every((value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value)), "Exact project and repository required");
    const servicePrefix = `arn:aws:apprunner:${selected.region}:${selected.account}:service/`;
    need(typeof selected.serviceArn === "string" && selected.serviceArn.startsWith(servicePrefix) && selected.serviceArn.slice(servicePrefix.length).split("/").length === 2 && selected.serviceArn.slice(servicePrefix.length).split("/").every(text), "Exact service ARN/account/region required");
    need(control.service === selected.serviceArn, "Control service differs from release service");
    need(typeof selected.sourceUrl === "string" && /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(selected.sourceUrl), "Exact GitHub source required");
    need(selected.buildspec === "infra/aws/buildspec.yml" && selected.port === "8080" && selected.computeType === "BUILD_GENERAL1_SMALL" && selected.timeoutMinutes === 20, "Reviewed build and service settings required");
    need(selected.blobs && Object.keys(selected.blobs).length === 2 && [selected.buildspec, "apps/api/Dockerfile"].every((path) => isSha(selected.blobs[path])), "Reviewed buildspec and Dockerfile blobs required");
    this.#control = control;
    this.#root = control.root;
    this.#provider = provider;
    this.#verifySource = verifySource;
    this.#spec = frozen(selected);
    this.#clock = clock ?? control.clock ?? Date.now;
  }

  async #call(service, operation, input) {
    try { return await this.#provider.call(service, operation, frozen(structuredClone(input))); }
    catch { throw new Error(`${operation} failed; raw provider details withheld; resume only a recorded ID`); }
  }

  async #source(sha) {
    try { await this.#verifySource(frozen({ sha, sourceUrl: this.#spec.sourceUrl, buildspec: this.#spec.buildspec, blobs: this.#spec.blobs })); }
    catch { throw new Error("Release source verification failed"); }
  }

  #planPath(planHash) {
    need(isHash(planHash), "Missing or invalid bound preflight plan");
    return join(this.#root, `aws-plan-${planHash}.json`);
  }

  #savePlan(plan) {
    const bytes = serialized(plan), planHash = bytesHash(bytes), path = this.#planPath(planHash);
    let fd;
    try { fd = openSync(path, "wx", 0o600); }
    catch (error) {
      need(error?.code === "EEXIST", "Cannot store immutable preflight plan");
      need(readFileSync(path, "utf8") === bytes, "Existing preflight plan differs; reconcile without overwriting");
      return planHash;
    }
    try { writeFileSync(fd, bytes); fsyncSync(fd); }
    finally { closeSync(fd); }
    return planHash;
  }

  #plan(record) {
    let bytes, plan;
    try { bytes = readFileSync(this.#planPath(record.planHash), "utf8"); plan = JSON.parse(bytes); }
    catch { throw new Error("Bound preflight plan is missing or malformed; reconcile without replacement"); }
    need(bytesHash(bytes) === record.planHash && plan.version === 1 && plan.sha === record.sha && hash(plan.spec) === hash(this.#spec), "Preflight plan identity mismatch");
    need(plan.hashes && Object.keys(plan.hashes).length === 3 && ["service", "project", "repository"].every((key) => isHash(plan.hashes[key])) && hash(plan.hashes) === record.configurationHash, "Preflight protected configuration mismatch");
    need(plan.repositoryUri === this.#repositoryUri() && this.#validImage(plan.oldImage), "Preflight image identity mismatch");
    return frozen(plan);
  }

  #repositoryUri() { return `${this.#spec.account}.dkr.ecr.${this.#spec.region}.amazonaws.com/${this.#spec.repository}`; }
  #validImage(image) {
    return image === `${this.#repositoryUri()}:latest` || (typeof image === "string" && image.startsWith(`${this.#repositoryUri()}@`) && isDigest(image.slice(this.#repositoryUri().length + 1)));
  }

  async #operations() {
    const operations = [], tokens = new Set(), ids = new Set();
    let NextToken;
    do {
      const page = await this.#call("apprunner", "ListOperations", { ServiceArn: this.#spec.serviceArn, ...(NextToken ? { NextToken } : {}) });
      need(Array.isArray(page.OperationSummaryList), "Operation history is missing");
      for (const operation of page.OperationSummaryList) {
        need(text(operation.Id) && !ids.has(operation.Id), "Ambiguous operation ID in history");
        operationStatus(operation.Status);
        ids.add(operation.Id); operations.push(operation);
      }
      need(operations.length <= 2000, "Operation history exceeds bounded reader");
      NextToken = page.NextToken;
      if (NextToken) {
        need(text(NextToken) && !tokens.has(NextToken) && tokens.size < 100, "Invalid or excessive operation pagination");
        tokens.add(NextToken);
      }
    } while (NextToken);
    return operations;
  }

  async #snapshot(plan, operationId) {
    const s = this.#spec;
    const identity = await this.#call("sts", "GetCallerIdentity", {});
    need(identity.Account === s.account, "Provider account mismatch");
    const projects = await this.#call("codebuild", "BatchGetProjects", { names: [s.project] });
    const project = projects.projects?.[0];
    need(projects.projects?.length === 1 && !projects.projectsNotFound?.length && project?.arn === `arn:aws:codebuild:${s.region}:${s.account}:project/${s.project}`, "Existing project/account mismatch");
    this.#buildSource(project.source);
    need(project.environment?.computeType === s.computeType && project.timeoutInMinutes === s.timeoutMinutes && project.environment.privilegedMode === true, "Existing build settings differ");
    need(project.autoRetryLimit === undefined || project.autoRetryLimit === 0, "Automatic build retries are enabled; hold without changing the project");
    const repositories = await this.#call("ecr", "DescribeRepositories", { repositoryNames: [s.repository] });
    const repository = repositories.repositories?.[0];
    need(repositories.repositories?.length === 1 && repository?.registryId === s.account && repository.repositoryArn === `arn:aws:ecr:${s.region}:${s.account}:repository/${s.repository}` && repository.repositoryUri === this.#repositoryUri(), "Existing ECR repository/account mismatch");
    const destinations = project.environment.environmentVariables?.filter((entry) => entry.name === "REPO_URI");
    need(destinations?.length === 1 && destinations[0].value === repository.repositoryUri, "Build destination differs");
    const service = (await this.#call("apprunner", "DescribeService", { ServiceArn: s.serviceArn })).Service;
    need(service?.ServiceArn === s.serviceArn && service.ServiceName === s.serviceArn.split("/")[1], "Existing service identity mismatch");
    const source = service.SourceConfiguration, image = source?.ImageRepository;
    need(image?.ImageRepositoryType === "ECR" && source.AutoDeploymentsEnabled === false && this.#validImage(image.ImageIdentifier), "Existing service is not the expected manual ECR image service");
    need(image.ImageConfiguration?.Port === s.port && text(source.AuthenticationConfiguration?.AccessRoleArn) && text(service.InstanceConfiguration?.InstanceRoleArn), "Existing image or role configuration is missing");
    const env = image.ImageConfiguration.RuntimeEnvironmentVariables;
    need(env && ["SPEND_DAILY_USD", "SPEND_TOTAL_USD"].every((key) => typeof env[key] === "string" && env[key].trim() && Number.isFinite(Number(env[key])) && Number(env[key]) >= 0), "Existing spend controls are missing or invalid");
    const operations = await this.#operations();
    need(operations.filter((op) => operationStatus(op.Status) === "IN_PROGRESS").every((op) => op.Id === operationId && op.TargetArn === s.serviceArn && op.Type === "UPDATE_SERVICE"), "Another service operation is active");
    need(service.Status === "RUNNING" || (operationId && service.Status === "OPERATION_IN_PROGRESS"), "Service is not ready or in the recorded update");
    const protectedSource = structuredClone(source);
    delete protectedSource.ImageRepository.ImageIdentifier;
    const hashes = {
      service: hash({ source: protectedSource, ...pick(service, serviceFields) }),
      project: hash(pick(project, projectFields)),
      repository: hash(pick(repository, repositoryFields)),
    };
    if (plan) need(hash(hashes) === hash(plan.hashes), "Protected resource configuration drifted");
    return { service, source, hashes, operations, currentImage: image.ImageIdentifier, repositoryUri: repository.repositoryUri };
  }

  #buildSource(source) {
    need(source?.type === "GITHUB" && source.location === this.#spec.sourceUrl && source.buildspec === this.#spec.buildspec, "Build source or buildspec differs");
  }

  async #image(imageId) {
    const result = await this.#call("ecr", "DescribeImages", { repositoryName: this.#spec.repository, imageIds: [imageId] });
    const image = result.imageDetails?.[0];
    need(result.imageDetails?.length === 1 && image?.registryId === this.#spec.account && image.repositoryName === this.#spec.repository && isDigest(image.imageDigest), "Expected image has no unique valid digest");
    if (imageId.imageDigest) need(image.imageDigest === imageId.imageDigest, "Image digest differs");
    if (imageId.imageTag) need(image.imageTags?.includes(imageId.imageTag), "Reviewed source tag is absent from image proof");
    return image.imageDigest;
  }

  async #build(record, { tag = true } = {}) {
    need(text(record.build?.id), "No recorded build ID; reconcile intent without replacement");
    const result = await this.#call("codebuild", "BatchGetBuilds", { ids: [record.build.id] });
    const build = result.builds?.[0];
    need(result.builds?.length === 1 && !result.buildsNotFound?.length && build?.id === record.build.id && build.projectName === this.#spec.project && build.sourceVersion === record.sha, "Recorded build identity/source mismatch");
    this.#buildSource(build.source);
    const status = buildStatus(build.buildStatus);
    if (!build.resolvedSourceVersion) throw new UnresolvedSource(build.id, build.buildStatus);
    need(build.resolvedSourceVersion === record.sha, "Build resolved a different source");
    const proof = { id: build.id, sha: build.resolvedSourceVersion, status };
    if (status === "SUCCEEDED") {
      const digest = await this.#image(tag ? { imageTag: record.sha.slice(0, 12) } : { imageDigest: record.build.digest });
      need(!record.build.digest || digest === record.build.digest, "Recorded source image digest changed");
      proof.digest = digest;
    }
    return proof;
  }

  async #active(identity) {
    const state = await this.#control.inspect(), record = state.active;
    need(record?.id === identity.attemptId && record.owner === identity.owner && !record.transferTo, "Attempt/owner mismatch or transfer pending");
    return { record, plan: this.#plan(record) };
  }

  async prepare({ sha, owner }) {
    need(isSha(sha) && text(owner), "Exact source and owner required");
    const state = await this.#control.inspect();
    if (state.active) {
      need(state.active.sha === sha && state.active.owner === owner && !state.active.transferTo, "Another attempt is active; reconcile or transfer it");
      this.#plan(state.active);
      return state.active;
    }
    need(!state.completed[sha], "Completed source exists; verify alreadyDeployed instead of rebuilding");
    need(!state.holds.length, "Unresolved review hold");
    await this.#source(sha);
    const current = await this.#snapshot();
    if (current.currentImage.includes("@")) await this.#image({ imageDigest: current.currentImage.split("@")[1] });
    else await this.#image({ imageTag: "latest" }); // Tag observation is not proof of running bytes.
    const plan = { version: 1, sha, spec: this.#spec, repositoryUri: current.repositoryUri, oldImage: current.currentImage, hashes: current.hashes };
    const planHash = this.#savePlan(plan);
    return this.#control.begin({ sha, owner, configurationHash: hash(plan.hashes), planHash });
  }

  async #request(record, plan, phase) {
    need(["build", "deploy"].includes(phase), "Unknown mutation phase");
    need(!record[phase], "Intent already exists; resume its recorded ID or reconcile ambiguity");
    await this.#source(record.sha);
    const current = await this.#snapshot(plan);
    need(current.service.Status === "RUNNING" && current.currentImage === plan.oldImage, "Service image changed before mutation");
    if (phase === "build") return frozen({ projectName: this.#spec.project, sourceVersion: record.sha });
    need(record.build?.status === "SUCCEEDED" && isDigest(record.build.digest), "Verified successful build required");
    const proof = await this.#build(record);
    need(proof.status === "SUCCEEDED" && proof.digest === record.build.digest, "Recorded build is not successful");
    const source = structuredClone(current.source);
    source.ImageRepository.ImageIdentifier = `${plan.repositoryUri}@${proof.digest}`;
    return frozen({ ServiceArn: this.#spec.serviceArn, SourceConfiguration: source });
  }

  async #mutationPlan(identity, phase) {
    const { record, plan } = await this.#active(identity);
    const request = await this.#request(record, plan, phase);
    return { phase, requestHash: hash(request), planHash: record.planHash, ...(phase === "deploy" ? { image: request.SourceConfiguration.ImageRepository.ImageIdentifier } : {}) };
  }

  async buildPlan(identity) { return this.#mutationPlan(identity, "build"); }
  async deployPlan(identity) { return this.#mutationPlan(identity, "deploy"); }

  async submit({ attemptId, owner, phase, requestHash }) {
    need(["build", "deploy"].includes(phase) && isHash(requestHash), "Bound mutation request required");
    const { record, plan } = await this.#active({ attemptId, owner });
    const clearance = structuredClone(record.clearance);
    // Read-only failures have not submitted anything and must not create an ambiguous intent.
    const request = await this.#request(record, plan, phase);
    need(hash(request) === requestHash, "Reconstructed mutation differs from reviewed request");
    const checkClearance = () => {
      const age = this.#clock() - (clearance?.at ?? NaN), current = this.#control.fingerprints();
      need(clearance?.phase === phase && clearance.requestHash === requestHash && age >= 0 && age <= 600000 && current.inbox === clearance.fingerprints.inbox && current.outbox === clearance.fingerprints.outbox, "Release clearance changed or expired during provider preflight");
    };
    checkClearance();
    return this.#control.submit({ attemptId, owner, phase, requestHash }, async ({ token, sha, digest }) => {
      need(sha === record.sha && (phase !== "deploy" || digest === record.build?.digest), "Submission source/image changed");
      checkClearance();
      // No awaited work between the final clearance read and the single provider mutation.
      if (phase === "build") {
        const result = await this.#call("codebuild", "StartBuild", { ...request, idempotencyToken: token });
        need(text(result.build?.id), "StartBuild returned no ID; retain ambiguous intent");
        return { id: result.build.id };
      }
      const result = await this.#call("apprunner", "UpdateService", request);
      need(text(result.OperationId), "UpdateService returned no ID; retain ambiguous intent");
      return { id: result.OperationId };
    });
  }

  async #deployment(record, plan) {
    need(text(record.deploy?.id) && isDigest(record.build?.digest), "Recorded deployment and image required");
    const current = await this.#snapshot(plan, record.deploy.id);
    const expectedImage = `${plan.repositoryUri}@${record.build.digest}`;
    need([plan.oldImage, expectedImage].includes(current.currentImage), "Unexpected image during recorded deployment");
    const operation = current.operations.find((entry) => entry.Id === record.deploy.id);
    if (!operation) return { id: record.deploy.id, status: "IN_PROGRESS", operationPending: true };
    need(operation.TargetArn === this.#spec.serviceArn && operation.Type === "UPDATE_SERVICE", "Recorded operation target/type mismatch");
    const status = operationStatus(operation.Status);
    if (status !== "SUCCEEDED") return { id: operation.Id, status };
    need(current.service.Status === "RUNNING" && current.currentImage === expectedImage, "Successful operation lacks expected running image");
    const proof = await this.#build(record, { tag: false });
    need(proof.status === "SUCCEEDED" && proof.digest === record.build.digest, "Completed deployment build proof changed");
    return { id: operation.Id, status, sha: proof.sha, digest: proof.digest, configurationHash: hash(current.hashes) };
  }

  async status({ attemptId, owner, phase }) {
    need(["build", "deploy"].includes(phase), "Unknown status phase");
    const identity = { attemptId, owner }, { record, plan } = await this.#active(identity);
    try {
      if (phase === "deploy") return await this.#control.observeDeployment(identity, (id) => {
        need(id === record.deploy?.id, "Recorded operation changed");
        return this.#deployment(record, plan);
      });
      return await this.#control.observeBuild(identity, async (id) => {
        need(id === record.build?.id, "Recorded build changed");
        await this.#snapshot(plan, record.deploy?.id);
        return this.#build(record);
      });
    } catch (error) {
      if (error instanceof UnresolvedSource) return phase === "deploy"
        ? { ...error.result, id: record.deploy.id, buildId: error.result.id }
        : error.result;
      throw error;
    }
  }

  async alreadyDeployed({ sha }) {
    return this.#control.alreadyDeployed({ sha }, async (record) => {
      const proof = await this.#deployment(record, this.#plan(record));
      need(proof.status === "SUCCEEDED", "Recorded deployment is not successful");
      return { ...proof, status: "RUNNING" };
    });
  }
}
