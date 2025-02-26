using System.Collections.Generic;
using System.Linq;
using Core.Entities;
using UnityEngine;

namespace Services.Selection
{
    public static class DamageCalculationService
    {
        // Проверяет, достаточно ли урона для уничтожения сущности
        public static bool CanDestroyEntity(Hero hero, Entity entity)
        {

            return hero.Damage.Value >= entity.Health.Value;
        }

        public static void Reset(Hero hero)
        {
            hero.Damage.Reset();
        }

        // Пересчитывает урон на основе текущей очереди
        public static void RecalculateDamage(Hero hero, List<Entity> selectedEntities)
        {
            Reset(hero);

            var enemiesHealth = selectedEntities.Sum(entity => entity.Health.Value);
            
            hero.Damage.SetValue(hero.Damage.Value + selectedEntities.Count - enemiesHealth);
        }
    }
}