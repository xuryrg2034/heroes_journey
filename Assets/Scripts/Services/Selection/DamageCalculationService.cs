using System.Collections.Generic;
using System.Linq;
using Core.Entities;
using UnityEngine;

namespace Services.Selection
{
    public static class DamageCalculationService
    {
        // Проверяет, достаточно ли урона для уничтожения сущности
        public static bool CanDestroyEntity(GameObject hero, Entity entity)
        {

            return false;  // return hero.RemainingDamage >= entity.Health;
        }

        public static void Reset(GameObject hero)
        {
            // hero.ResetDamage();
        }

        // Пересчитывает урон на основе текущей очереди
        public static void RecalculateDamage(GameObject hero, List<Entity> selectedEntities)
        {
            // Reset(hero);

            // var enemiesHealth = selectedEntities.Sum(entity => entity.Health);
            //
            // hero.SetDamage(hero.AttackDamage + selectedEntities.Count - enemiesHealth);
        }
    }
}