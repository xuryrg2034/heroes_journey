using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Grid;

namespace Abilities.EnemyAbilities
{
    [Serializable]
    public class MassAttackAbility : BaseAbility
    {
        public override async UniTask Execute()
        {
            var notEmptyCells = Owner.Cell
                .GetNeighbors()
                .Where((item) => item.Type != CellType.Blocked)
                .ToList();
            var entityList = notEmptyCells.Select(cell => cell.GetEntity()).Where(entity => entity).ToList();

            var task = new List<UniTask>();
            
            foreach (var entity in entityList)
            {
                var tween = entity.Health.TakeDamage(1);
            
                task.Add(tween);
            }

            await UniTask.WhenAll(task);
        }
    }
}