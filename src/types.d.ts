declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.md?text" {
  const content: string;
  export default content;
}
