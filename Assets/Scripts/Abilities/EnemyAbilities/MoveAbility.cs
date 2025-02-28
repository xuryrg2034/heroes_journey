using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Grid;
using Random = UnityEngine.Random;

namespace Abilities.EnemyAbilities
{
    [Serializable]
    public class MoveAbility : BaseAbility
    {
        public override async UniTask Execute()
        {
            var notEmptyCells = Owner.Cell
                .GetNeighbors()
                .Where((item) => item.Type != CellType.Blocked)
                .ToList();
            var randomCell = notEmptyCells[Random.Range(0, notEmptyCells.Count)];
            var entityOnCell = randomCell.GetEntity();
            var tasks = new List<UniTask>();
            
            if (entityOnCell)
            {
                tasks.Add(entityOnCell.Move(Owner.Cell));
            }

            tasks.Add(Owner.Move(randomCell));

            await UniTask.WhenAll(tasks);
        }
    }
}