-- CreateTable
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "linkedin" TEXT NOT NULL,
    "github" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "university" TEXT NOT NULL,
    "college" TEXT NOT NULL,
    "graduation" TEXT NOT NULL,
    "gpa" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "coursework" TEXT,
    "awards" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SkillGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    CONSTRAINT "Skill_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SkillGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "company" TEXT,
    "location" TEXT,
    "position" TEXT,
    "title" TEXT,
    "duration" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Bullet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "experienceId" TEXT NOT NULL,
    CONSTRAINT "Bullet_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BulletTag" (
    "bulletId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    PRIMARY KEY ("bulletId", "tag"),
    CONSTRAINT "BulletTag_bulletId_fkey" FOREIGN KEY ("bulletId") REFERENCES "Bullet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "bulletId" TEXT NOT NULL,
    "jobSlug" TEXT,
    CONSTRAINT "Variant_bulletId_fkey" FOREIGN KEY ("bulletId") REFERENCES "Bullet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Variant_jobSlug_fkey" FOREIGN KEY ("jobSlug") REFERENCES "Job" ("slug") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rationale" TEXT,
    "customSkills" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobBullet" (
    "jobSlug" TEXT NOT NULL,
    "bulletId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "variantId" TEXT,

    PRIMARY KEY ("jobSlug", "bulletId"),
    CONSTRAINT "JobBullet_jobSlug_fkey" FOREIGN KEY ("jobSlug") REFERENCES "Job" ("slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobBullet_bulletId_fkey" FOREIGN KEY ("bulletId") REFERENCES "Bullet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobBullet_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobSkill" (
    "jobSlug" TEXT NOT NULL,
    "skillId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    PRIMARY KEY ("jobSlug", "skillId"),
    CONSTRAINT "JobSkill_jobSlug_fkey" FOREIGN KEY ("jobSlug") REFERENCES "Job" ("slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillGroup_category_key" ON "SkillGroup"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_groupId_name_key" ON "Skill"("groupId", "name");
