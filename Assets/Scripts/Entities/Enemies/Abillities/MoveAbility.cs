using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Grid;
using Random = UnityEngine.Random;

namespace Entities.Enemies
{
    [Serializable]
    public class MoveAbility : BaseAbility
    {
        private Cell _cellToMove;
        
        public override async UniTask Execute()
        {
            if (_tryToExecute())
            {
                await _execute();
                _reset();
            }
            else if (State != State.Preparing)
            {
                _prepare();   
            }
        }

        public override void Cancel()
        {
            if (State != State.Preparing) return;

            _reset();
        }

        private void _prepare()
        {
            State = State.Preparing;

            var notEmptyCells = Owner.Cell
                .GetNeighbors()
                .Where((item) => item.Type != CellType.Blocked)
                .ToList();
            
            _cellToMove = notEmptyCells[Random.Range(0, notEmptyCells.Count)];
            _cellToMove.Highlite(true);
        }

        private async UniTask _execute()
        {
            State = State.Execute;

            var entityOnCell = _cellToMove.GetEntity();
            var tasks = new List<UniTask>();
            
            if (entityOnCell)
            {
                tasks.Add(entityOnCell.Move(Owner.Cell));
            }
            
            tasks.Add(Owner.Move(_cellToMove));

            await UniTask.WhenAll(tasks);
        }

        private void _reset()
        {
            _cellToMove.Highlite(false);
            _cellToMove = null;
            _castCounter = 0;
            State = State.Pending;
        }
    }
}