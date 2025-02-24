using System.Collections.Generic;
using System.Linq;
using Core.Entities;

namespace Services.Selection
{
    public static class DamageCalculationService
    {
        // Проверяет, достаточно ли урона для уничтожения сущности
        public static bool CanDestroyEntity(Hero hero, Entity entity)
        {
            return hero.RemainingDamage >= entity.Health;
        }

        public static void Reset(Hero hero)
        {
            hero.ResetDamage();
        }

        // Пересчитывает урон на основе текущей очереди
        public static void RecalculateDamage(Hero hero, List<Entity> selectedEntities)
        {
            Reset(hero);

            var enemiesHealth = selectedEntities.Sum(entity => entity.Health);

            hero.SetDamage(hero.AttackDamage + selectedEntities.Count - enemiesHealth);
        }
    }
}