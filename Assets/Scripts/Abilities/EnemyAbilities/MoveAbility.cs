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
        private Cell _cellToMove;
        
        public override async UniTask Execute()
        {
            if (_tryToExecute())
            {
                _castCounter = 0;

                await _execute();
            }
            else
            {
                _prepare();   
            }
        }

        private void _prepare()
        {
            var notEmptyCells = Owner.Cell
                .GetNeighbors()
                .Where((item) => item.Type != CellType.Blocked)
                .ToList();
            
            _cellToMove = notEmptyCells[Random.Range(0, notEmptyCells.Count)];
            _cellToMove.Highlite(true);
        }

        private async UniTask _execute()
        {
            var entityOnCell = _cellToMove.GetEntity();
            var tasks = new List<UniTask>();
            
            if (entityOnCell)
            {
                tasks.Add(entityOnCell.Move(Owner.Cell));
            }

            tasks.Add(Owner.Move(_cellToMove));

            _cellToMove.Highlite(false);

            await UniTask.WhenAll(tasks);
        }
    }
}